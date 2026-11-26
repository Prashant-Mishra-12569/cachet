import { randomBytes } from 'node:crypto';
import { AccountAddress, signMessage, type AccountSigner } from '@concordium/web-sdk';
import { canonicalize, sealCloseMessage, sealRequestMessage, sha256Hex } from '@cachet/shared/seal';

/**
 * Cachet SDK for AI callers (plan §12): get a seal right before dialling, close it when the call ends.
 * The AI's own Concordium key signs every request; Cachet never holds it.
 * Pass an x402-paying `fetch` (@x402/fetch) so a seal is paid automatically when credits run out.
 */
export interface CachetClientOptions {
  /** Cachet API base URL, e.g. https://api.cachet.example or http://localhost:8787. */
  baseUrl: string;
  /** The AI caller's "Verified by Concordium" badge. */
  badge: string;
  account: string;
  signer: AccountSigner;
  fetch?: typeof fetch;
  /** For tests: how to wait between retries. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SealCallInput {
  /** The person being called (E.164). */
  to: string;
  /** The number the call comes from: must be registered for this AI caller. */
  from: string;
  purpose: string;
  /** ≤ 80 chars, shown on the card. No links, no long numbers. */
  message: string;
  amount?: { value: string; asset: string } | undefined;
}

export interface Seal {
  sealId: string;
  company: string;
  /** "47-21" */
  code: string;
  /** "four-seven, two-one" */
  spokenCode: string;
  /** What the AI must say first: AI disclosure + the code. */
  firstLine: string;
  issuedAt: string;
  expiresAt: string;
  verifyUrl: string;
  creditsLeft: number;
  /** The x402 settlement, when this seal was paid on the spot. */
  x402Tx: string | null;
}

export type CloseReason = 'completed' | 'no_answer' | 'failed' | 'cancelled';

/** "closed" = this request ended it; "already_ended" = it had already ended (closed, replaced or expired). */
export type CloseResult = 'closed' | 'already_ended';

export class CachetError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CachetError';
  }
}

export function createCachetClient(options: CachetClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const http = options.fetch ?? fetch;
  const address = AccountAddress.fromBase58(options.account);
  const nonce = () => randomBytes(16).toString('hex');
  const now = () => Math.floor(Date.now() / 1000);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function post(
    path: string,
    request: Record<string, unknown>,
    message: (d: string) => string,
    timeoutMs?: number,
  ) {
    const signature = await signMessage(address, message(sha256Hex(canonicalize(request))), options.signer);
    const res = await http(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request, signature }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (body['error'] ?? {}) as { code?: string; message?: string };
      throw new CachetError(res.status, err.code ?? 'unknown', err.message ?? `HTTP ${res.status}`);
    }
    return { body, res };
  }

  return {
    /** Ask Cachet for a seal for this call. Call it right before dialling. */
    async sealCall(input: SealCallInput): Promise<Seal> {
      const request = {
        v: 'cachet-seal-request/1',
        badge: options.badge,
        agentAccount: options.account,
        to: input.to,
        from: input.from,
        purpose: input.purpose,
        message: input.message,
        ...(input.amount ? { amount: input.amount } : {}),
        nonce: nonce(),
        ts: now(),
      };
      const { body, res } = await post('/v1/seals', request, sealRequestMessage);
      const receipt = res.headers.get('PAYMENT-RESPONSE');
      let x402Tx: string | null = null;
      if (receipt) {
        try {
          x402Tx =
            (JSON.parse(Buffer.from(receipt, 'base64').toString('utf8')) as { transaction?: string })
              .transaction ?? null;
        } catch {
          x402Tx = null;
        }
      }
      return { ...(body as unknown as Omit<Seal, 'x402Tx'>), x402Tx };
    },

    /**
     * The call ended: close the seal so the person's card stops showing it as verified.
     * Keeps trying through lost connections and server hiccups for up to `retryForMs` (default 2 min):
     * a seal left open would keep a green card for a call that is over. Each try is freshly signed
     * (new nonce). If an earlier try did reach Cachet, the next one answers "already ended".
     */
    async closeSeal(
      sealId: string,
      reason: CloseReason,
      opts: { retryForMs?: number } = {},
    ): Promise<CloseResult> {
      const giveUpAt = Date.now() + (opts.retryForMs ?? 120_000);
      for (let attempt = 0; ; attempt++) {
        try {
          await post(
            `/v1/seals/${encodeURIComponent(sealId)}/close`,
            {
              v: 'cachet-seal-close/1',
              sealId,
              agentAccount: options.account,
              reason,
              nonce: nonce(),
              ts: now(),
            },
            sealCloseMessage,
            15_000,
          );
          return 'closed';
        } catch (err) {
          if (err instanceof CachetError) {
            if (err.code === 'seal_not_open') return 'already_ended';
            // A clear "no" (bad request, wrong signature, …) won't change by retrying.
            if (err.status < 500 && err.status !== 429) throw err;
          }
          const wait = Math.min(15_000, 1_000 * 2 ** attempt);
          if (Date.now() + wait > giveUpAt) throw err;
          await sleep(wait);
        }
      }
    },
  };
}

export type CachetClient = ReturnType<typeof createCachetClient>;

export { createPayingFetch, toAtomic } from './x402';
