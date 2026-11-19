/**
 * Decoder for CIS-8004 (Agent Registry) contract events, per the standard:
 * github.com/Concordium/concordium-update-proposals/blob/main/source/CIS/cis-8004.rst
 *
 *   Registered     ::= 240 AgentTokenId AccountAddress OptionalString OptionalHash256 OptionalExtRef
 *   URIUpdated     ::= 241 AgentTokenId OptionalString OptionalHash256
 *   Revoked        ::= 244 AgentTokenId AccountAddress OptionalString
 *   AgentWalletSet ::= 245 AgentTokenId OptionalAddress
 *   AgentTokenId   ::= 0x08 u64-LE
 *   String         ::= u32-LE length, bytes
 *
 * Other tags (CIS-2 Mint/Transfer, ExternalReferenceSet, MetadataSet …) are reported as `other`.
 * Trailing bytes are ignored on purpose: the live testnet contract appends a registered_at
 * timestamp (u64 ms) to Registered, which the written standard does not list (seen 19 Nov 2026).
 */
import { AccountAddress } from '@concordium/web-sdk';

export type RegistryEvent =
  | {
      type: 'Registered';
      tokenId: bigint;
      owner: string;
      agentUri: string | null;
      metadataHash: string | null;
    }
  | { type: 'URIUpdated'; tokenId: bigint; agentUri: string | null; metadataHash: string | null }
  | { type: 'Revoked'; tokenId: bigint; owner: string; reason: string | null }
  | { type: 'AgentWalletSet'; tokenId: bigint; wallet: string | null }
  | { type: 'other'; tag: number };

class Reader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new Error('CIS-8004 event is truncated');
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.pos++] as number;
  }
  take(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u32le(): number {
    const b = this.take(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }
  u64le(): bigint {
    const b = this.take(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
  }
  tokenId(): bigint {
    if (this.u8() !== 8) throw new Error('AgentTokenId must have length prefix 8');
    return this.u64le();
  }
  account(): string {
    // Copy into a fresh 32-byte buffer: for Node Buffers, slice() is a view over a shared pool.
    return AccountAddress.toBase58(AccountAddress.fromBuffer(new Uint8Array(this.take(32)).buffer));
  }
  string(): string {
    const n = this.u32le();
    return new TextDecoder('utf-8', { fatal: true }).decode(this.take(n));
  }
  optional<T>(read: () => T): T | null {
    const flag = this.u8();
    if (flag === 0) return null;
    if (flag !== 1) throw new Error(`invalid option tag ${flag}`);
    return read();
  }
  hash256(): string {
    return Buffer.from(this.take(32)).toString('hex');
  }
}

export function decodeRegistryEvent(event: Uint8Array): RegistryEvent {
  const r = new Reader(event);
  const tag = r.u8();
  switch (tag) {
    case 240: {
      const tokenId = r.tokenId();
      const owner = r.account();
      const agentUri = r.optional(() => r.string());
      const metadataHash = r.optional(() => r.hash256());
      return { type: 'Registered', tokenId, owner, agentUri, metadataHash };
    }
    case 241: {
      const tokenId = r.tokenId();
      const agentUri = r.optional(() => r.string());
      const metadataHash = r.optional(() => r.hash256());
      return { type: 'URIUpdated', tokenId, agentUri, metadataHash };
    }
    case 244: {
      const tokenId = r.tokenId();
      const owner = r.account();
      const reason = r.optional(() => r.string());
      return { type: 'Revoked', tokenId, owner, reason };
    }
    case 245: {
      const tokenId = r.tokenId();
      const wallet = r.optional(() => r.account());
      return { type: 'AgentWalletSet', tokenId, wallet };
    }
    default:
      return { type: 'other', tag };
  }
}
