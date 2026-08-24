/**
 * Shared pagination walker for Iagon's offset/limit endpoints.
 *
 * Consolidates the logic that was previously duplicated between the SDK's history walk
 * and the staking service's rewards/history fetchers (audit finding M-14). Behavior:
 *  - advances the offset by the number of rows actually returned (never assumes a full page),
 *  - honors `pagination.hasMore` when present (authoritative end-of-stream signal),
 *  - treats a short page as end-of-stream ONLY when pagination metadata is absent,
 *  - stops on an empty page (cannot advance) and at a hard MAX_PAGES safety bound,
 *  - fails loud: a page reporting `success === false` aborts the walk via `onPageFailure`
 *    rather than silently truncating the aggregated result.
 *
 * `fetchPage` may also throw (e.g. a network error) — that propagates unchanged, which is
 * likewise fail-loud.
 */

export const PAGINATION_PAGE_SIZE = 100;
export const PAGINATION_MAX_PAGES = 1000; // safety bound: up to 100k rows per walk

export interface PaginatedPage<T> {
  success?: boolean;
  data?: T[];
  pagination?: { hasMore?: boolean };
}

export interface CollectAllPagesOptions {
  pageSize?: number;
  maxPages?: number;
  startOffset?: number;
  /** Invoked when a page reports success === false; must throw (fail-loud). */
  onPageFailure: (ctx: { offset: number; page: number }) => never;
}

export const collectAllPages = async <T>(
  fetchPage: (offset: number, limit: number) => Promise<PaginatedPage<T>>,
  options: CollectAllPagesOptions
): Promise<T[]> => {
  const pageSize = options.pageSize ?? PAGINATION_PAGE_SIZE;
  const maxPages = options.maxPages ?? PAGINATION_MAX_PAGES;
  let offset = options.startOffset ?? 0;
  const aggregated: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPage(offset, pageSize);

    if (res.success === false) options.onPageFailure({ offset, page });

    const items = res.data ?? [];
    aggregated.push(...items);

    const hasMore = res.pagination?.hasMore;
    if (hasMore === false) break;
    // An empty page cannot advance the offset; stop rather than loop forever.
    if (items.length === 0) break;
    // Without pagination metadata, a short page is the only end-of-stream signal;
    // with hasMore === true a short page still continues.
    if (hasMore === undefined && items.length < pageSize) break;
    offset += items.length;
  }

  return aggregated;
};
