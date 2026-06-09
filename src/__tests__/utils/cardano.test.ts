import { describe, it, expect } from '@jest/globals';
import { bech32 } from 'bech32';
import { isSpendableUtxo, assertRecipientAddress } from '../../utils/cardano.js';
import { UtxoData, Networks, SdkApiError } from '../../types/index.js';

const makeBaseAddress = (mainnet: boolean): string => {
  // Header byte 0x01 = base address, payment-key + stake-key.
  // Network nibble: 1 = mainnet, 0 = preprod.
  const header = Buffer.from([mainnet ? 0x01 : 0x00]);
  const payment = Buffer.alloc(28, 0x11);
  const stake = Buffer.alloc(28, 0x22);
  const hrp = mainnet ? 'addr' : 'addr_test';
  return bech32.encode(hrp, bech32.toWords(Buffer.concat([header, payment, stake])), 1000);
};

const makeUtxo = (overrides: Partial<UtxoData> = {}): UtxoData => ({
  transaction_id: 'a'.repeat(64),
  output_index: 0,
  address: 'addr1qx',
  value: { lovelace: 1_500_000, assets: {} },
  datum_hash: null,
  script_hash: null,
  created_at: { slot_no: 0, header_hash: 'b'.repeat(64) },
  ...overrides,
});

// M-06: filter out UTxOs that cannot be spent with a simple Ed25519 witness.
describe('isSpendableUtxo (M-06)', () => {
  it('accepts a plain UTxO (no datum, no script)', () => {
    expect(isSpendableUtxo(makeUtxo())).toBe(true);
  });

  it('rejects a UTxO with a datum_hash', () => {
    expect(isSpendableUtxo(makeUtxo({ datum_hash: 'c'.repeat(64) }))).toBe(false);
  });

  it('rejects a UTxO with a script_hash', () => {
    expect(isSpendableUtxo(makeUtxo({ script_hash: 'd'.repeat(56) }))).toBe(false);
  });

  it('rejects a UTxO with both datum_hash and script_hash', () => {
    expect(
      isSpendableUtxo(
        makeUtxo({
          datum_hash: 'c'.repeat(64),
          script_hash: 'd'.repeat(56),
        })
      )
    ).toBe(false);
  });

  it('treats empty strings as falsy (no datum/script)', () => {
    // Defensive: although the API types use string | null, an empty string
    // also indicates "absent" and must still be spendable.
    expect(
      isSpendableUtxo(
        makeUtxo({
          datum_hash: '' as unknown as string | null,
          script_hash: '' as unknown as string | null,
        })
      )
    ).toBe(true);
  });
});

// M-02: recipientAddress must be a valid bech32 address on the SDK's network.
describe('assertRecipientAddress (M-02)', () => {
  it('accepts a mainnet address when SDK is on mainnet', () => {
    expect(() => assertRecipientAddress(makeBaseAddress(true), Networks.MAINNET)).not.toThrow();
  });

  it('accepts a preprod address when SDK is on preprod', () => {
    expect(() => assertRecipientAddress(makeBaseAddress(false), Networks.PREPROD)).not.toThrow();
  });

  it('rejects a mainnet address when SDK is on preprod', () => {
    expect(() => assertRecipientAddress(makeBaseAddress(true), Networks.PREPROD)).toThrow(
      SdkApiError
    );
  });

  it('rejects a preprod address when SDK is on mainnet', () => {
    expect(() => assertRecipientAddress(makeBaseAddress(false), Networks.MAINNET)).toThrow(
      SdkApiError
    );
  });

  it('rejects malformed bech32 with ValidationError', () => {
    try {
      assertRecipientAddress('addr1notreallyvalid', Networks.MAINNET);
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SdkApiError);
      expect((err as SdkApiError).statusCode).toBe(400);
      expect((err as SdkApiError).errorType).toBe('ValidationError');
    }
  });

  it('rejects a non-cardano string with ValidationError', () => {
    expect(() => assertRecipientAddress('hello world', Networks.MAINNET)).toThrow(SdkApiError);
  });

  it('returns descriptive error info for network mismatch', () => {
    try {
      assertRecipientAddress(makeBaseAddress(true), Networks.PREPROD);
      throw new Error('expected to throw');
    } catch (err) {
      const e = err as SdkApiError;
      expect(e.message).toMatch(/network mismatch/i);
      expect(e.errorInfo).toMatchObject({ expectedNetworkId: 0, actualNetworkId: 1 });
    }
  });
});
