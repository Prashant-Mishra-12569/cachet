import type { AccountTransactionSignature } from '@concordium/web-sdk';
import type { MessageCheck, OnChainAgent } from '@cachet/concordium';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';
import {
  buildMerkleTree,
  callCode,
  canonicalize,
  formatCode,
  normalizeE164,
  phoneHash,
  sealCloseMessage,
  sealRequestMessage,
  sha256Hex,
  signSeal,
  spokenCode,
  ulid,
  verifyMerkleProof,
  verifySealSignature,
  type Seal,
  type SealSigningKey,
  type UnsignedSeal,
} from '@cachet/shared/seal';
import type { RegistryGateway } from '../agents/registry-gateway';
import type { AgentRecord, AgentRepo } from '../agents/repo';
import type { BusinessRepo } from '../business/repo';
import type { KvStore } from '../infra/kv';
import type { InclusionData } from '../worker/anchor-repo';
import type { SealRepo, SealRow } from './repo';

/** What the AI sends (and signs) to get a seal before it dials. */
export interface SealRequest {
  v: 'cachet-seal-request/1';
  /** The agent's badge: base58 CIS-2 token address in the Agent Registry. */
  badge: string;
  agentAccount: string;
  /** The person being called, E.164. Never stored or published in clear. */
  to: string;
  from: string;
  purpose: string;
  message: string;
  amount?: { value: string; asset: string } | undefined;
  /** 16+ random bytes, hex. Single use. */
  nonce: string;
  /** Unix seconds when the AI created the request. */
  ts: number;
}

export interface CloseRequest {
  v: 'cachet-seal-close/1';
  sealId: string;
  agentAccount: string;
  reason: 'completed' | 'no_answer' | 'failed' | 'cancelled';
  nonce: string;
  ts: number;
}

export type SealErrorCode =
  | 'seal_stale'
  | 'seal_replay'
  | 'seal_bad_signature'
  | 'agent_unknown'
  | 'agent_account_mismatch'
  | 'agent_revoked'
  | 'agent_card_mismatch'
  | 'business_suspended'
  | 'number_not_allowed'
  | 'purpose_not_allowed'
  | 'message_not_allowed'
  | 'amount_not_allowed'
  | 'invalid_phone'
  | 'payment_required'
  | 'seal_conflict'
  | 'consent_revoked'
  | 'seal_not_found'
  | 'seal_not_open';

export class SealError extends Error {
  constructor(
    readonly code: SealErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'SealError';
  }
}

export interface SealServiceDeps {
  seals: SealRepo;
  agents: AgentRepo;
  businesses: BusinessRepo;
  gateway: Pick<RegistryGateway, 'readAgent'>;
  verifyMessage: (
    address: string,
    message: string,
    signature: AccountTransactionSignature,
  ) => Promise<MessageCheck>;
  kv: KvStore;
  signingKey: SealSigningKey;
  callCodeSecret: string;
  phonePepper: string;
  network: Network;
  /** The PLT used for payments (EUDemo on testnet). */
  pltTokenId: string;
  webOrigin: string;
  /** Seal lifetime. Plan: 15 minutes. */
  ttlSeconds?: number;
  /** Allowed clock difference for request timestamps. */
  maxSkewSeconds?: number;
  /** How long a live on-chain agent read is reused. Revocation shows up within this time. */
  chainCacheMs?: number;
  /** The callee's choice for this company (/consent in the bot), or null if none. */
  consentFor?: (phoneHash: string, businessId: string) => Promise<'granted' | 'revoked' | null>;
  /** Public Agent Registry service URL, for "check this badge yourself" links. */
  registryUrl?: string;
  /** Where a ledger item sits in an on-chain anchor (from the anchoring worker). */
  inclusion?: (kind: string, refId: string) => Promise<InclusionData | null>;
  /** Optional: fetch an account's keys ahead of time (keeps signature checks instant). */
  prefetchAccount?: (address: string) => Promise<void>;
  now?: () => number;
}

/** Messages are shown to the person: no links and no long numbers (phishing / fake callback numbers). */
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|in|co|xyz|app|link|ly|me|info|biz)\b)/i;
const LONG_NUMBER = /\d[\d\s-]{4,}\d/;
const AMOUNT = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/;

export const SEAL_CHANNEL = 'cachet:seals';

export function createSealService(deps: SealServiceDeps) {
  const ttl = deps.ttlSeconds ?? 15 * 60;
  const skew = deps.maxSkewSeconds ?? 120;
  const nowMs = deps.now ?? Date.now;
  const caip2 = NETWORK_CONFIG[deps.network].caip2;
  const chainCache = new Map<string, { at: number; agent: OnChainAgent | null }>();

  async function liveAgent(tokenId: bigint, force = false): Promise<OnChainAgent | null> {
    const key = tokenId.toString();
    const hit = chainCache.get(key);
    if (!force && hit && nowMs() - hit.at < (deps.chainCacheMs ?? 15_000)) return hit.agent;
    const agent = await deps.gateway.readAgent(tokenId);
    chainCache.set(key, { at: nowMs(), agent });
    return agent;
  }

  /** Signature + freshness + single use. Returns the request digest. */
  async function authenticate(
    request: SealRequest | CloseRequest,
    signature: AccountTransactionSignature,
    message: (digest: string) => string,
  ): Promise<string> {
    const nowS = Math.floor(nowMs() / 1000);
    if (Math.abs(nowS - request.ts) > skew)
      throw new SealError('seal_stale', `ts ${request.ts} vs now ${nowS}`);
    const digest = sha256Hex(canonicalize(request));
    const check = await deps.verifyMessage(request.agentAccount, message(digest), signature);
    if (!check.ok) throw new SealError('seal_bad_signature', check.reason);
    // Only after the signature is valid, so nobody can burn another agent's nonces.
    const fresh = await deps.kv.claim(`seal:nonce:${request.agentAccount}:${request.nonce}`, 2 * skew + 60);
    if (!fresh) throw new SealError('seal_replay');
    return digest;
  }

  /** Everything that must be true about the agent, its company and the chain before sealing. */
  async function checkAgent(agent: AgentRecord | null, agentAccount: string) {
    if (!agent || agent.status !== 'active' || agent.tokenId === null || !agent.badge) {
      throw new SealError('agent_unknown');
    }
    if (agent.agentAccount !== agentAccount) throw new SealError('agent_account_mismatch');
    const business = await deps.businesses.findById(agent.businessId);
    if (!business || business.status !== 'active') throw new SealError('business_suspended');

    const onChain = await liveAgent(agent.tokenId);
    if (!onChain || onChain.status !== 'Active') throw new SealError('agent_revoked', 'not active on chain');
    if (onChain.owner !== business.concordiumAccount)
      throw new SealError('agent_revoked', 'owner changed on chain');
    if (!onChain.agentWallet) throw new SealError('agent_revoked', 'no agentWallet on chain');
    if (onChain.metadataHash !== agent.metadataHash) throw new SealError('agent_card_mismatch');
    return { business, onChain };
  }

  /** Tell the bot / lamp a seal ended. Never blocks or fails the caller. */
  function publishClosed(row: Pick<SealRow, 'id' | 'phoneHash'>, reason: string) {
    deps.kv
      .publish(
        SEAL_CHANNEL,
        JSON.stringify({ type: 'seal.closed', sealId: row.id, phoneHash: row.phoneHash, reason }),
      )
      .catch((err: unknown) => console.error('[seals] publish failed', err));
  }

  /** Share-safe view of a seal: no phone data, no call code. */
  async function viewOf(row: SealRow) {
    const seal = JSON.parse(row.sealJson) as Seal;
    const agent = await deps.agents.findById(row.agentId);
    const business = await deps.businesses.findById(row.businessId);
    const included = deps.inclusion ? await deps.inclusion('seal', row.id) : null;
    // Live: is the AI caller still switched on in the Concordium Agent Registry right now?
    let onChain: 'active' | 'switched_off' | 'unknown' = 'unknown';
    if (agent?.tokenId != null) {
      try {
        const live = await liveAgent(agent.tokenId);
        onChain =
          live && live.status === 'Active' && live.owner === business?.concordiumAccount
            ? 'active'
            : 'switched_off';
      } catch {
        onChain = 'unknown'; // chain unreachable: say so, never guess
      }
    }
    return {
      id: row.id,
      status: statusOf(row, nowMs()),
      signatureValid: verifySealSignature(seal, deps.signingKey.publicKey),
      kid: seal.kid,
      sealHash: row.sealHash,
      company: { ...seal.company, status: business?.status ?? 'unknown' },
      agent: {
        name: agent?.name ?? null,
        badge: seal.agent.badge,
        tokenId: seal.agent.tokenId,
        onChain,
        /** Concordium's own, independent badge checker. */
        badgeCheckUrl: deps.registryUrl
          ? `${deps.registryUrl}/v1/check-badge/${seal.agent.badge.split(':').at(-1) ?? ''}`
          : null,
      },
      purpose: seal.purpose,
      message: seal.message,
      amount: seal.amount ?? null,
      from: seal.from,
      consent: seal.consent,
      issuedAt: new Date(seal.issuedAt * 1000).toISOString(),
      expiresAt: new Date(seal.expiresAt * 1000).toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      anchor: included ? proofView(included, row.sealHash) : { status: 'pending' as const },
    };
  }

  const service = {
    /**
     * Keep the hot path off the chain: refresh every active agent's on-chain record (and its AI's
     * account keys) in the background. Call at start-up and every ~10 s.
     */
    async warm() {
      const active = await deps.agents.listActive();
      await Promise.allSettled(
        active.flatMap((a) => [
          a.tokenId !== null ? liveAgent(a.tokenId, true) : Promise.resolve(null),
          deps.prefetchAccount ? deps.prefetchAccount(a.agentAccount) : Promise.resolve(),
        ]),
      );
      return active.length;
    },

    async issue(request: SealRequest, signature: AccountTransactionSignature) {
      const agent = await deps.agents.findByBadge(request.badge);
      // Cheap checks on our own data first, then the signature, then the chain.
      if (!agent) throw new SealError('agent_unknown');
      const digest = await authenticate(request, signature, sealRequestMessage);
      const { business } = await checkAgent(agent, request.agentAccount);

      const from = normalizeE164(request.from);
      if (!from || !agent.callingNumbers.includes(from)) throw new SealError('number_not_allowed');
      if (!agent.purposes.includes(request.purpose as never)) throw new SealError('purpose_not_allowed');
      const message = request.message.trim();
      if (!message || message.length > 80 || LINK.test(message) || LONG_NUMBER.test(message)) {
        throw new SealError('message_not_allowed');
      }
      if (request.amount) {
        const { value, asset } = request.amount;
        if (asset !== deps.pltTokenId || !AMOUNT.test(value) || Number(value) <= 0) {
          throw new SealError('amount_not_allowed');
        }
      }
      const to = normalizeE164(request.to);
      if (!to) throw new SealError('invalid_phone');
      const calleeHash = phoneHash(deps.phonePepper, to);
      // "Who may call me" (/consent): a person who blocked this company gets no sealed calls from it.
      const consent = deps.consentFor ? await deps.consentFor(calleeHash, business.id) : null;
      if (consent === 'revoked') throw new SealError('consent_revoked');

      const issuedMs = nowMs();
      const id = ulid(issuedMs);
      const code = callCode(deps.callCodeSecret, id);
      const issuedAt = Math.floor(issuedMs / 1000);
      const unsigned: UnsignedSeal = {
        v: 'cachet/1',
        id,
        network: caip2,
        kid: deps.signingKey.kid,
        company: {
          legalName: business.legalName,
          legalCountry: business.legalCountry,
          account: business.concordiumAccount,
          proofTx: business.proofTx,
        },
        agent: {
          badge: `${caip2}/cis-2:${agent.badge}`,
          tokenId: String(agent.tokenId),
          account: agent.agentAccount,
          requestDigest: digest,
          sig: Object.fromEntries(
            Object.entries(signature).map(([c, keys]) => [c, Object.fromEntries(Object.entries(keys))]),
          ) as Seal['agent']['sig'],
        },
        callee: { phoneHash: calleeHash },
        from,
        purpose: request.purpose,
        message,
        ...(request.amount ? { amount: { value: request.amount.value, asset: request.amount.asset } } : {}),
        code,
        issuedAt,
        expiresAt: issuedAt + ttl,
        // Never imply consent we don't have (plan §29.3).
        consent: consent === 'granted' ? 'granted' : 'none_recorded',
        payment: { method: 'x402-credit', ref: (await deps.seals.latestPurchaseTx(agent.id)) ?? 'none' },
      };
      const seal = signSeal(unsigned, deps.signingKey);
      const json = canonicalize(seal);
      const hash = sha256Hex(json);

      const result = await deps.seals.issue(
        {
          id,
          agentId: agent.id,
          businessId: business.id,
          phoneHash: seal.callee.phoneHash,
          fromE164: from,
          purpose: seal.purpose,
          message,
          amountValue: seal.amount?.value ?? null,
          amountAsset: seal.amount?.asset ?? null,
          code,
          issuedAt: new Date(issuedAt * 1000),
          expiresAt: new Date(seal.expiresAt * 1000),
          sealJson: json,
          sealHash: hash,
        },
        { kind: 'seal', refId: id, itemHash: hash },
      );
      if (!result.ok)
        throw new SealError(result.reason === 'conflict' ? 'seal_conflict' : 'payment_required');

      // Tell the bot / lamp (Phase 3). Never blocks or fails the seal.
      deps.kv
        .publish(
          SEAL_CHANNEL,
          JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: seal.callee.phoneHash }),
        )
        .catch((err: unknown) => console.error('[seals] publish failed', err));

      return {
        sealId: id,
        code: formatCode(code),
        spokenCode: spokenCode(code),
        firstLine: `Hi, this is ${business.legalName}'s AI assistant. Your Cachet code is ${spokenCode(code)}.`,
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        expiresAt: new Date(seal.expiresAt * 1000).toISOString(),
        verifyUrl: `${deps.webOrigin}/v/${id}`,
        creditsLeft: result.creditsLeft,
      };
    },

    /** The call ended: the seal stops showing green immediately (fixes the "false green" window). */
    async close(request: CloseRequest, signature: AccountTransactionSignature) {
      const row = await deps.seals.get(request.sealId);
      if (!row) throw new SealError('seal_not_found');
      const agent = await deps.agents.findById(row.agentId);
      if (!agent || agent.agentAccount !== request.agentAccount) throw new SealError('seal_not_found');
      await authenticate(request, signature, sealCloseMessage);

      const closedAt = new Date(nowMs());
      const item = {
        v: 'cachet-seal-closed/1',
        sealId: row.id,
        closedAt: closedAt.toISOString(),
        reason: request.reason,
      };
      const closed = await deps.seals.close(row.id, agent.id, closedAt, request.reason, {
        kind: 'seal_closed',
        refId: row.id,
        itemHash: sha256Hex(canonicalize(item)),
      });
      if (!closed) throw new SealError('seal_not_open');
      publishClosed(row, request.reason);
      return { sealId: row.id, status: 'closed' as const, closedAt: closedAt.toISOString() };
    },

    /**
     * The person blocked this company (/consent): end its open seals to them right away, so /check
     * never shows a blocked company as green. Returns how many were ended.
     */
    async endForCallee(calleeHash: string, businessId: string, reason: 'blocked_by_callee') {
      const now = new Date(nowMs());
      const open = (await deps.seals.openForPhone(calleeHash, now)).filter(
        (r) => r.businessId === businessId,
      );
      let ended = 0;
      for (const row of open) {
        const item = { v: 'cachet-seal-closed/1', sealId: row.id, closedAt: now.toISOString(), reason };
        const closed = await deps.seals.close(row.id, row.agentId, now, reason, {
          kind: 'seal_closed',
          refId: row.id,
          itemHash: sha256Hex(canonicalize(item)),
        });
        if (!closed) continue; // the AI closed it at the same moment: already ended
        ended++;
        publishClosed(row, reason);
      }
      return ended;
    },

    /** Public, share-safe view: no phone data, no call code. */
    async publicView(id: string) {
      const row = await deps.seals.get(id);
      if (!row) throw new SealError('seal_not_found');
      return viewOf(row);
    },

    /**
     * The seal as the CALLED PERSON sees it (Telegram Mini App): the public view plus the call code
     * and, if money is asked, who would be paid. Anyone else gets "not found" (never "forbidden",
     * so seal ids can't be probed for whose they are).
     */
    async calleeView(id: string, calleeHash: string) {
      const row = await deps.seals.get(id);
      if (!row || row.phoneHash !== calleeHash) throw new SealError('seal_not_found');
      const view = await viewOf(row);
      const seal = JSON.parse(row.sealJson) as Seal;
      let pay: {
        amount: { value: string; asset: string };
        company: string;
        /** The AI caller's agentWallet, read from the Concordium Agent Registry (never from the call). */
        recipient: string | null;
        fee: 'free';
        /** Paying is possible only while the call is verified and the wallet is known. */
        ready: boolean;
      } | null = null;
      if (seal.amount) {
        const agent = await deps.agents.findById(row.agentId);
        let recipient: string | null = null;
        if (agent?.tokenId != null) {
          try {
            const live = await liveAgent(agent.tokenId);
            if (live && live.status === 'Active' && live.owner === seal.company.account) {
              recipient = live.agentWallet ?? null;
            }
          } catch {
            recipient = null; // chain unreachable: no recipient means no payment, never a guess
          }
        }
        pay = {
          amount: seal.amount,
          company: seal.company.legalName,
          recipient,
          fee: 'free',
          ready: view.status === 'open' && recipient !== null && view.company.status === 'active',
        };
      }
      return { ...view, code: formatCode(seal.code), pay };
    },
  };
  return service;
}

export type SealService = ReturnType<typeof createSealService>;

/**
 * Inclusion proof for the public seal page: rebuilt from the anchor's items and checked here,
 * so anyone can re-check it against the on-chain root.
 */
function proofView(inc: InclusionData, sealHash: string) {
  const tree = buildMerkleTree(inc.batch);
  const proof = tree.proofs[inc.leafIndex] ?? [];
  const proofValid =
    inc.itemHash === sealHash &&
    tree.root === inc.anchor.merkleRoot &&
    verifyMerkleProof(sealHash, proof, tree.root);
  return {
    status: inc.anchor.status,
    txHash: inc.anchor.txHash,
    root: inc.anchor.merkleRoot,
    itemHash: inc.itemHash,
    leafIndex: inc.leafIndex,
    itemCount: inc.anchor.itemCount,
    proof,
    proofValid,
  };
}

export function statusOf(row: Pick<SealRow, 'status' | 'expiresAt'>, nowMs: number) {
  if (row.status === 'open' && row.expiresAt.getTime() <= nowMs) return 'expired' as const;
  return row.status;
}
