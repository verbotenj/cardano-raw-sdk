/**
 * Protocol Parameters Management
 *
 * Provides configurable Cardano protocol parameters with sensible defaults.
 * Parameters can be overridden at SDK initialization to adapt to protocol
 * changes without requiring an SDK update.
 *
 * Usage:
 *   // At SDK init (optional)
 *   setProtocolParams({ minFeeA: 44, minFeeB: 155381 });
 *
 *   // Throughout codebase
 *   const { minFeeA, minFeeB } = getProtocolParams();
 */

import { ProtocolParams } from "../types/config.js";
import { CardanoConstants, CardanoAmounts } from "../constants.js";

/**
 * Default protocol parameters based on current Cardano mainnet values.
 * These serve as fallbacks when no custom params are provided.
 */
const DEFAULT_PROTOCOL_PARAMS: ProtocolParams = {
  minFeeA: CardanoConstants.MIN_FEE_A, // 44
  minFeeB: CardanoConstants.MIN_FEE_B, // 155381
  coinsPerUtxoByte: CardanoAmounts.COINS_PER_UTXO_BYTE, // 4310
  stakeKeyDeposit: CardanoAmounts.DEPOSIT_AMOUNT, // 2_000_000
  drepDeposit: CardanoAmounts.DREP_REGISTRATION_DEPOSIT, // 500_000_000
};

/**
 * Current protocol parameters (singleton).
 * Starts with defaults, can be updated via setProtocolParams().
 */
let currentParams: ProtocolParams = { ...DEFAULT_PROTOCOL_PARAMS };

/**
 * Get current protocol parameters.
 * Returns a copy to prevent accidental mutation.
 */
export const getProtocolParams = (): Readonly<ProtocolParams> => {
  return { ...currentParams };
};

/**
 * Update protocol parameters.
 * Merges provided values with current params (partial update supported).
 *
 * @param params - Partial protocol parameters to update
 */
export const setProtocolParams = (params: Partial<ProtocolParams>): void => {
  currentParams = {
    ...currentParams,
    ...params,
  };
};

/**
 * Reset protocol parameters to defaults.
 * Useful for testing or when switching networks.
 */
export const resetProtocolParams = (): void => {
  currentParams = { ...DEFAULT_PROTOCOL_PARAMS };
};

/**
 * Get the default protocol parameters (immutable).
 * Useful for reference or resetting to known values.
 */
export const getDefaultProtocolParams = (): Readonly<ProtocolParams> => {
  return { ...DEFAULT_PROTOCOL_PARAMS };
};
