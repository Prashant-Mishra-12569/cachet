/**
 * Client for Concordium's Credential Verification Service (Verify & Access), v0.3.x.
 * Source of truth: github.com/Concordium/concordium-misc-tools/tree/main/credential-verification-service
 *
 * The service anchors every request (VRA) and every verified proof (VAA) on-chain, paying from
 * its own account.
 */

export type Statement =
  | { type: 'RevealAttribute'; attributeTag: string }
  | { type: 'AttributeInRange'; attributeTag: string; lower: string; upper: string }
  | { type: 'AttributeInSet' | 'AttributeNotInSet'; attributeTag: string; set: string[] };

export interface RequestedClaim {
  type: 'identity';
  source: ('accountCredential' | 'identityCredential')[];
  /** e.g. "did:ccd:testnet:idp:4" */
  issuers: string[];
  statements: Statement[];
}

export interface CreateRequestInput {
  connectionId: string;
  resourceId: string;
  contextString?: string;
  /** Public metadata written on-chain with the request anchor. Never put personal data here. */
  publicInfo?: Record<string, string>;
  requestedClaims: RequestedClaim[];
}

/** VerificationRequestV1 as JSON. Passed to the wallet as-is and back to the service on verify. */
export interface VerificationRequestJson {
  type: 'ConcordiumVerificationRequestV1';
  transactionRef: string;
  [key: string]: unknown;
}

export interface VerifyResponse {
  result: 'verified' | { failed: { code: string; message: string } };
  verificationAuditRecord?: { presentation?: unknown; [key: string]: unknown };
  anchorTransactionHash?: string | null;
}

export class VerifierError extends Error {
  constructor(
    message: string,
    /** HTTP status from the service; 0 if it could not be reached. */
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'VerifierError';
  }
}

export interface VerifierClient {
  createRequest(input: CreateRequestInput): Promise<VerificationRequestJson>;
  verify(input: {
    auditRecordId: string;
    presentation: unknown;
    verificationRequest: VerificationRequestJson;
  }): Promise<VerifyResponse>;
  health(): Promise<boolean>;
}

interface ServiceError {
  error?: { code?: string; message?: string };
}

export function createVerifierClient(options: {
  url: string;
  healthUrl: string;
  timeoutMs?: number;
}): VerifierClient {
  const base = options.url.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new VerifierError(`Verifier unreachable: ${err instanceof Error ? err.message : String(err)}`, 0);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new VerifierError(`Verifier returned non-JSON (HTTP ${res.status})`, res.status);
    }
    if (!res.ok) {
      const err = (json as ServiceError).error;
      throw new VerifierError(err?.message ?? `Verifier HTTP ${res.status}`, res.status, err?.code);
    }
    return json as T;
  }

  return {
    async createRequest(input) {
      const request = await post<VerificationRequestJson>(
        '/verifiable-presentations/create-verification-request',
        input,
      );
      if (request?.type !== 'ConcordiumVerificationRequestV1' || typeof request.transactionRef !== 'string') {
        throw new VerifierError('Verifier returned an unexpected verification request', 502);
      }
      return request;
    },
    verify: (input) => post<VerifyResponse>('/verifiable-presentations/verify', input),
    async health() {
      try {
        const res = await fetch(options.healthUrl, { signal: AbortSignal.timeout(3_000) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
