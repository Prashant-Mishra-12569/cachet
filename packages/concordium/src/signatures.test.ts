import { describe, expect, it } from 'vitest';
import { normalizeAccountAddress, parseAccountSignature } from './signatures';

const SIG = 'ab'.repeat(64);

describe('parseAccountSignature', () => {
  it('accepts the wallet shape { cred: { key: hex128 } }', () => {
    expect(parseAccountSignature({ 0: { 0: SIG } })).toEqual({ 0: { 0: SIG } });
  });

  it.each([
    ['null', null],
    ['array', [SIG]],
    ['empty object', {}],
    ['flat string value', { 0: SIG }],
    ['short signature', { 0: { 0: 'abcd' } }],
    ['non-hex signature', { 0: { 0: 'zz'.repeat(64) } }],
    ['non-numeric index', { x: { 0: SIG } }],
  ])('rejects %s', (_name, value) => {
    expect(parseAccountSignature(value)).toBeUndefined();
  });
});

describe('normalizeAccountAddress', () => {
  it('accepts a valid address and trims spaces', () => {
    const a = '3dt3UMPzRASZndjmKpSWgCP2HhmoxZrgs8FDPtZjNHZzj13hhB';
    expect(normalizeAccountAddress(`  ${a} `)).toBe(a);
  });

  it('rejects an address with a wrong checksum', () => {
    expect(normalizeAccountAddress('35sHhKDcJHrrHSgvFpsYxqb6g97uaQTd2kE31rPUeDZTeDsjVq')).toBeUndefined();
  });
});
