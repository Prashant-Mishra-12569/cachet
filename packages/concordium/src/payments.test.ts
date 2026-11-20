import { describe, expect, it } from 'vitest';
import { Transaction } from '@concordium/web-sdk/transactions';
import { checkPayment, decimalToRaw, memoHex, toWireJson, type ExpectedPayment } from './payments';

const SENDER = '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq';
const SPONSOR = '35sHhKYuw7zk3iKZZjysLEh8BarcwxAJ4pQcZVB8kT9i4pkB5z';
const COMPANY = '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa';

/** The REAL finalized summary of testnet tx 43d6b6ea… (sponsored 0.01 EUDemo, 20 Nov), as plain JSON. */
const REAL = {
  index: '0',
  energyCost: { value: '814', __type: 'ccd_energy' },
  hash: '43d6b6ea8c298ff9dcb1df43e012cf4221225396e6099ba9443ad304ea5a615a',
  type: 'accountTransaction',
  cost: '0',
  sender: SENDER,
  sponsor: { cost: '6167602', sponsor: SPONSOR },
  transactionType: 'tokenUpdate',
  events: [
    {
      tag: 'TokenTransfer',
      tokenId: 'EUDemo',
      from: { type: 'account', address: SENDER },
      to: { type: 'account', address: COMPANY },
      amount: { value: '10000', decimals: 6 },
      memo: '706361636865743a7061792d736d6f6b65',
    },
  ],
};
const EXPECTED: ExpectedPayment = {
  tokenId: 'EUDemo',
  recipient: COMPANY,
  amountRaw: 10000n,
  decimals: 6,
  memo: 'cachet:pay-smoke',
};

describe('sponsored payments', () => {
  it('converts decimal amounts to raw token units exactly', () => {
    expect(decimalToRaw('12.40', 6)).toBe(12_400_000n);
    expect(decimalToRaw('0.01', 6)).toBe(10_000n);
    expect(decimalToRaw('7', 6)).toBe(7_000_000n);
    expect(() => decimalToRaw('0.0000001', 6)).toThrow();
    expect(() => decimalToRaw('-1', 6)).toThrow();
    expect(() => decimalToRaw('1e3', 6)).toThrow();
  });

  it('encodes the memo exactly as the chain recorded it', () => {
    expect(memoHex('cachet:pay-smoke')).toBe('706361636865743a7061792d736d6f6b65');
  });

  it('accepts the real sponsored payment', () => {
    expect(checkPayment(REAL, EXPECTED)).toEqual({ ok: true, payer: SENDER, sponsor: SPONSOR });
  });

  it('refuses anything that is not exactly the expected payment', () => {
    expect(checkPayment(REAL, { ...EXPECTED, amountRaw: 10001n })).toMatchObject({ ok: false });
    expect(checkPayment(REAL, { ...EXPECTED, recipient: SENDER })).toMatchObject({ ok: false });
    expect(checkPayment(REAL, { ...EXPECTED, memo: 'cachet:other-seal' })).toMatchObject({ ok: false });
    expect(checkPayment(REAL, { ...EXPECTED, tokenId: 'EURR' })).toMatchObject({ ok: false });
    expect(checkPayment(REAL, { ...EXPECTED, decimals: 2, amountRaw: 1n })).toMatchObject({ ok: false });
    expect(checkPayment({ ...REAL, transactionType: 'failed' }, EXPECTED)).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(checkPayment({ ...REAL, type: 'updateTransaction' }, EXPECTED)).toMatchObject({ ok: false });
  });

  it('wire JSON round-trips through signableFromJSON (bigint as numbers, not strings)', () => {
    const json = { a: 5n, big: 2n ** 70n };
    expect(toWireJson(json)).toBe(`{"a":5,"big":"${(2n ** 70n).toString()}"}`);
    expect(typeof Transaction.signableFromJSON).toBe('function');
  });
});
