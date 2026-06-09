import { describe, it, expect } from '@jest/globals';
import { bech32 } from 'bech32';
import { buildPayload } from '../../utils/staking.utils.js';
import { Networks } from '../../types/index.js';

/**
 * Helper: build a syntactically valid Shelley-era preprod base address
 * (header 0x00 + 28-byte payment hash + 28-byte stake hash) so buildPayload
 * has a parseable target for the output.
 */
const makePreprodAddress = (): string => {
  const header = Buffer.from([0x00]);
  const payment = Buffer.alloc(28, 0x11);
  const stake = Buffer.alloc(28, 0x22);
  const fullBytes = Buffer.concat([header, payment, stake]);
  return bech32.encode('addr_test', bech32.toWords(fullBytes), 1000);
};

/**
 * Look for the exact CBOR byte sequence for an unsigned integer value
 * (major type 0). cbor2 emits the minimum-length form, and BigInt values
 * are encoded with the same major-type-0 layout as Numbers, so a successful
 * search proves the value was serialized as a CBOR unsigned int with full
 * precision.
 */
const cborUintBytes = (value: bigint): number[] => {
  if (value < 0n) throw new Error('expected unsigned');
  if (value < 24n) return [Number(value)];
  if (value < 256n) return [0x18, Number(value)];
  if (value < 65536n) return [0x19, Number(value >> 8n) & 0xff, Number(value) & 0xff];
  if (value < 0x1_0000_0000n) {
    return [
      0x1a,
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn),
    ];
  }
  // 8-byte form for >= 2^32
  const out = [0x1b];
  for (let i = 7n; i >= 0n; i--) {
    out.push(Number((value >> (i * 8n)) & 0xffn));
  }
  return out;
};

const bufferContainsSequence = (buf: Buffer, seq: number[]): boolean => {
  outer: for (let i = 0; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
};

// M-04: hand-built CBOR transaction body must encode lovelace and fee with
// full integer precision (no JS Number 53-bit truncation).
describe('buildPayload - M-04 BigInt lovelace/fee encoding', () => {
  const baseOptions = {
    toAddress: makePreprodAddress(),
    txInputs: [{ txHash: Buffer.alloc(32, 0xaa), indexInTx: 0 }],
    network: Networks.PREPROD,
  };

  it('encodes typical lovelace and fee as CBOR unsigned integers', () => {
    const { serialized } = buildPayload({
      ...baseOptions,
      netAmount: 2_000_000,
      feeAmount: 200_000,
    });

    expect(bufferContainsSequence(serialized, cborUintBytes(2_000_000n))).toBe(true);
    expect(bufferContainsSequence(serialized, cborUintBytes(200_000n))).toBe(true);
  });

  it('uses 8-byte CBOR uint encoding for lovelace > 2^32', () => {
    const big = 5_000_000_000n; // 5 billion lovelace = 5,000 ADA, > 2^32
    const { serialized } = buildPayload({
      ...baseOptions,
      netAmount: Number(big),
      feeAmount: 200_000,
    });

    const expected = cborUintBytes(big);
    expect(expected[0]).toBe(0x1b); // 8-byte uint header
    expect(bufferContainsSequence(serialized, expected)).toBe(true);
  });

  it('rounds fractional inputs to integers before BigInt conversion', () => {
    const { serialized } = buildPayload({
      ...baseOptions,
      netAmount: 1_500_000.6,
      feeAmount: 200_000.4,
    });

    expect(bufferContainsSequence(serialized, cborUintBytes(1_500_001n))).toBe(true);
    expect(bufferContainsSequence(serialized, cborUintBytes(200_000n))).toBe(true);
  });
});
