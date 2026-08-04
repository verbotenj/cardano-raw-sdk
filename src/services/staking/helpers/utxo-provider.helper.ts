/**
 * UTXO Provider Helper
 * Handles UTXO finding and selection logic
 */

import {
  Logger,
  selectPureAdaUtxos,
  sumPureAdaLovelace,
  formatWithDecimals,
  utxoLocks,
  filterSpendableUtxos,
} from "../../../utils/index.js";
import { SdkApiError } from "../../../types/index.js";
import { FireblocksService, IagonApiService } from "../../index.js";
import {
  INetworkConfiguration,
  IUtxoProvider,
  AddressWithUtxo,
} from "../types/staking.interfaces.js";

export class UtxoProvider implements IUtxoProvider {
  constructor(
    private readonly fireblocksService: FireblocksService,
    private readonly iagonApiService: IagonApiService,
    private readonly networkConfig: INetworkConfiguration,
    private readonly logger: Logger
  ) {}

  async findAddressWithSuitableUtxo(
    vaultAccountId: string,
    minAmount: number
  ): Promise<AddressWithUtxo> {
    const addresses = await this.getVaultAddresses(vaultAccountId);

    // Track the largest single-address pure-ADA balance seen, to produce an actionable
    // error when funds exist but are fragmented across addresses.
    let bestPureAdaOnAnyAddress = 0;

    for (const addressObj of addresses) {
      if (addressObj.addressFormat !== "BASE" || !addressObj.address) {
        continue;
      }

      const utxosResponse = await this.iagonApiService.getUtxosByAddress(addressObj.address);
      const data = utxosResponse.data ?? [];

      // Exclude script/datum UTXOs (not spendable with a simple Ed25519 witness) and any
      // UTXOs currently locked by a concurrent operation, then aggregate pure-ADA UTxOs
      // from this single address to cover the amount (audit finding S-4).
      const spendable = filterSpendableUtxos(data, "staking").filter(
        (u) => !utxoLocks.isLocked(u.transaction_id, u.output_index)
      );

      const selection = selectPureAdaUtxos(spendable, minAmount);
      if (selection) {
        // Atomically lock all selected UTxOs. A concurrent operation may have locked one
        // between the availability check above and here, so skip the address if so.
        const release = utxoLocks.tryLock(
          selection.utxos.map((u) => ({ transaction_id: u.txHash, output_index: u.indexInTx }))
        );
        if (release === null) {
          this.logger.debug(
            `Selected UTxOs on address ${addressObj.address} were locked concurrently, skipping`
          );
          continue;
        }

        this.logger.info(
          `Selected ${selection.utxos.length} pure-ADA UTxO(s) totaling ` +
            `${formatWithDecimals(selection.total, 6).value} ADA from address ${addressObj.address}`
        );
        return {
          address: addressObj.address,
          addressIndex: addressObj.bip44AddressIndex ?? 0,
          utxos: selection.utxos,
          totalAmount: selection.total,
          release,
        };
      }

      bestPureAdaOnAnyAddress = Math.max(bestPureAdaOnAnyAddress, sumPureAdaLovelace(spendable));
      this.logger.debug(`No sufficient pure-ADA UTxOs on address ${addressObj.address}`);
    }

    throw this.createInsufficientFundsError(vaultAccountId, minAmount, bestPureAdaOnAnyAddress);
  }

  private async getVaultAddresses(vaultAccountId: string) {
    const addresses = await this.fireblocksService.getVaultAccountAddresses(
      vaultAccountId,
      this.networkConfig.assetId
    );

    if (!addresses || addresses.length === 0) {
      throw new SdkApiError(
        "No addresses found for vault account",
        400,
        "NO_ADDRESSES",
        { vaultAccountId },
        "staking-service"
      );
    }

    return addresses;
  }

  private createInsufficientFundsError(
    vaultAccountId: string,
    minAmount: number,
    bestPureAdaOnAnyAddress: number
  ): SdkApiError {
    const requiredAda = formatWithDecimals(minAmount, 6).value;
    const availableAda = formatWithDecimals(bestPureAdaOnAnyAddress, 6).value;

    // Distinguish "funds are fragmented across addresses" from "not enough funds at all",
    // so the consumer can take the right action (consolidate vs. fund) — audit finding S-4.
    const fragmented = bestPureAdaOnAnyAddress > 0 && bestPureAdaOnAnyAddress < minAmount;
    const message = fragmented
      ? `No single address holds enough pure-ADA UTxOs to cover ${requiredAda} ADA. ` +
        `The largest single-address pure-ADA balance is ${availableAda} ADA. Consolidate your ` +
        `UTxOs onto one address (or send ${requiredAda} ADA in a single output) and retry.`
      : `No address with pure-ADA UTxOs totaling at least ${requiredAda} ADA found. ` +
        `Please send ${requiredAda} ADA (without tokens) to this vault.`;

    return new SdkApiError(
      message,
      400,
      fragmented ? "FRAGMENTED_PURE_ADA" : "INSUFFICIENT_PURE_ADA",
      { vaultAccountId, requiredAmount: minAmount, bestPureAdaOnAnyAddress },
      "staking-service"
    );
  }
}
