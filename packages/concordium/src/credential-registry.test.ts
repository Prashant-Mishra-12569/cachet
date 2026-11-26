import { describe, expect, it } from 'vitest';
import { Parameter } from '@concordium/web-sdk';
import {
  decodeCredentialStatus,
  parseContractAddress,
  registerCredentialParameter,
  registryInitParameter,
  revokeCredentialParameter,
} from './credential-registry';

const HOLDER = 'aa06317f8e52942e5728bb67de22aa279c8cdb5d408edb9667fa7b2c65199943';
const bytes = (p: Parameter.Type) => Buffer.from(Parameter.toBuffer(p));

describe('credential registry encoding (CIS-4 template)', () => {
  it('registerCredential: holder key, not holder-revocable, valid_from in ms, no end, then the url', () => {
    const validFrom = new Date('2026-11-26T12:00:00.000Z');
    const b = bytes(
      registerCredentialParameter({
        holderIdHex: HOLDER,
        validFrom,
        metadataUrl: 'https://getcachet.site/w3id/x.json',
        auxiliary: 'cachet:agent:JyP9',
      }),
    );
    expect(b.subarray(0, 32).toString('hex')).toBe(HOLDER);
    expect(b[32]).toBe(0); // holder_revocable = false
    expect(b.readBigUInt64LE(33)).toBe(BigInt(validFrom.getTime()));
    expect(b[41]).toBe(0); // valid_until = None
    expect(b.toString('utf8')).toContain('https://getcachet.site/w3id/x.json');
    expect(b.subarray(-17).toString('utf8')).toBe('cachet:agent:JyP9');
  });

  it('revoke carries the reason; bad keys are refused before anything is sent', () => {
    const b = bytes(revokeCredentialParameter({ holderIdHex: HOLDER, reason: 'Company suspended' }));
    expect(b.subarray(0, 32).toString('hex')).toBe(HOLDER);
    expect(b.toString('utf8')).toContain('Company suspended');
    expect(() => revokeCredentialParameter({ holderIdHex: 'abc', reason: 'x' })).toThrow('32 bytes');
  });

  it('init: issuer account and key are encoded', () => {
    const b = bytes(
      registryInitParameter({
        issuerMetadataUrl: 'https://getcachet.site/w3id/issuer.json',
        credentialType: 'AuthorisedAICaller',
        schemaUrl: 'https://getcachet.site/w3id/schema.json',
        issuerAccount: '35sHhKYuw7zk3iKZZjysLEh8BarcwxAJ4pQcZVB8kT9i4pkB5z',
        issuerKeyHex: HOLDER,
      }),
    );
    expect(b.toString('utf8')).toContain('AuthorisedAICaller');
    expect(b.toString('hex')).toContain(HOLDER);
    expect(b.at(-1)).toBe(0); // no revocation keys
  });

  it('status bytes and contract addresses', () => {
    expect([0, 1, 2, 3, 9, undefined].map(decodeCredentialStatus)).toEqual([
      'active',
      'revoked',
      'expired',
      'not_activated',
      'not_found',
      'not_found',
    ]);
    expect(parseContractAddress('<13001,0>')).toEqual({ index: 13001n, subindex: 0n });
    expect(parseContractAddress('13001')).toEqual({ index: 13001n, subindex: 0n });
    expect(() => parseContractAddress('abc')).toThrow();
  });
});
