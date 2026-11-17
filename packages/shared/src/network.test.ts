import { describe, expect, it } from 'vitest';
import { explorerAccountUrl, explorerTxUrl, isNetwork, NETWORK_CONFIG } from './network';

describe('network constants', () => {
  it('uses the testnet CAIP-2 id from @x402/concordium', () => {
    expect(NETWORK_CONFIG.testnet.caip2).toBe('ccd:4221332d34e1694168c2a0c0b3fd0f27');
  });

  it('recognises only known networks', () => {
    expect(isNetwork('testnet')).toBe(true);
    expect(isNetwork('devnet')).toBe(false);
    expect(isNetwork(undefined)).toBe(false);
  });
});

describe('explorer links', () => {
  const hash = 'A'.repeat(64);

  it('builds a lower-case testnet transaction link', () => {
    expect(explorerTxUrl('testnet', hash)).toBe(
      `https://ccdexplorer.io/testnet/transaction/${'a'.repeat(64)}`,
    );
  });

  it('rejects anything that is not a 64-char hex hash', () => {
    expect(() => explorerTxUrl('testnet', 'abc')).toThrow();
    expect(() => explorerTxUrl('testnet', `${hash}/../x`)).toThrow();
  });

  it('rejects malformed account addresses', () => {
    expect(() => explorerAccountUrl('testnet', 'not-an-address')).toThrow();
  });
});
