import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { utxoLocks } from "../../utils/utxoLock.js";

// tryLock provides atomic check-and-acquire semantics: acquiring a
// UTxO that already holds a live lock fails instead of silently
// overwriting it, closing the check-then-act window between UTxO
// selection and lock acquisition in concurrent operations.

const TX_A = "aa".repeat(32);
const TX_B = "bb".repeat(32);

const releases: Array<() => void> = [];
const track = (release: (() => void) | null): (() => void) | null => {
  if (release) releases.push(release);
  return release;
};

afterEach(() => {
  while (releases.length) releases.pop()!();
});

describe("UtxoLockManager.tryLock - atomic acquisition", () => {
  it("acquires a free UTxO and returns a release function", () => {
    const release = track(utxoLocks.tryLockOne(TX_A, 0));
    expect(release).not.toBeNull();
    expect(utxoLocks.isLocked(TX_A, 0)).toBe(true);
  });

  it("returns null for a UTxO that already holds a live lock", () => {
    track(utxoLocks.tryLockOne(TX_A, 0));
    expect(utxoLocks.tryLockOne(TX_A, 0)).toBeNull();
  });

  it("allows re-acquisition after release", () => {
    const release = utxoLocks.tryLockOne(TX_A, 0);
    expect(release).not.toBeNull();
    release!();
    expect(utxoLocks.isLocked(TX_A, 0)).toBe(false);
    const second = track(utxoLocks.tryLockOne(TX_A, 0));
    expect(second).not.toBeNull();
  });

  it("acquires all-or-nothing: one contended UTxO fails the whole set", () => {
    track(utxoLocks.tryLockOne(TX_A, 1));
    const release = utxoLocks.tryLock([
      { transaction_id: TX_A, output_index: 1 },
      { transaction_id: TX_B, output_index: 0 },
    ]);
    expect(release).toBeNull();
    // The free UTxO in the failed set must not be left locked.
    expect(utxoLocks.isLocked(TX_B, 0)).toBe(false);
  });

  it("treats an expired lock as free", () => {
    const nowSpy = jest.spyOn(Date, "now");
    const base = Date.now();
    nowSpy.mockReturnValue(base);
    track(utxoLocks.tryLockOne(TX_A, 2));
    // Advance past the lock TTL; the stale lock must not block acquisition.
    nowSpy.mockReturnValue(base + 10 * 60 * 1000);
    const release = track(utxoLocks.tryLockOne(TX_A, 2));
    expect(release).not.toBeNull();
    nowSpy.mockRestore();
  });
});
