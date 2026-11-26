import 'server-only';

/** Where the Cachet server runs (server-side fetches can't use the /v1 rewrite). */
const API_URL = (process.env['API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '');

export interface PublicSeal {
  id: string;
  status: 'open' | 'closed' | 'superseded' | 'expired';
  signatureValid: boolean;
  kid: string;
  sealHash: string;
  company: {
    legalName: string;
    legalCountry: string;
    account: string;
    proofTx: string;
    proofTxUrl: string;
    status: 'active' | 'suspended' | 'unknown';
  };
  agent: {
    name: string | null;
    badge: string;
    tokenId: string;
    onChain: 'active' | 'switched_off' | 'unknown';
    badgeCheckUrl: string | null;
    /** Cachet's "Authorised AI Caller" credential (Concordium Web3 ID), live. Null when not set up. */
    credential?: {
      status: 'active' | 'revoked' | 'expired' | 'not_activated' | 'not_found' | 'unknown';
      registry: string;
      registryUrl: string;
    } | null;
  };
  purpose: string;
  message: string;
  amount: { value: string; asset: string } | null;
  from: string;
  consent: string;
  issuedAt: string;
  expiresAt: string;
  closedAt: string | null;
  anchor:
    | { status: 'pending' }
    | {
        status: 'pending' | 'submitted' | 'finalized' | 'failed';
        txHash: string | null;
        txUrl?: string;
        root: string;
        itemHash: string;
        leafIndex: number;
        itemCount: number;
        proof: string[];
        proofValid: boolean;
      };
}

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** null = no such seal (or a malformed id). Throws only if the server is unreachable. */
export async function getPublicSeal(id: string): Promise<PublicSeal | null> {
  if (!ULID.test(id)) return null;
  const res = await fetch(`${API_URL}/v1/seals/${id}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cachet server returned HTTP ${res.status}`);
  return (await res.json()) as PublicSeal;
}

export interface PublicStats {
  network: string;
  sealsTotal: number;
  sealsLast24h: number;
  sealsInPublicRecord: number;
  companiesVerified: number;
  aiCallersActive: number;
  paymentsTotal: number;
  lastRecord: { txHash: string; txUrl: string; items: number; at: string } | null;
  updatedAt: string;
}

/**
 * Live totals for the landing page. Refreshed at most every 30 s. Null when the server can't be
 * reached: the page then simply leaves the live numbers out instead of failing.
 */
export async function getPublicStats(): Promise<PublicStats | null> {
  try {
    const res = await fetch(`${API_URL}/v1/stats`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? ((await res.json()) as PublicStats) : null;
  } catch {
    return null;
  }
}

/** The server's own health check (for /status). Null when it can't be reached. */
export async function getHealth(): Promise<
  (Record<string, unknown> & { ok?: boolean; network?: string }) | null
> {
  try {
    const res = await fetch(`${API_URL}/healthz`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok
      ? ((await res.json()) as Record<string, unknown> & { ok?: boolean; network?: string })
      : null;
  } catch {
    return null;
  }
}
