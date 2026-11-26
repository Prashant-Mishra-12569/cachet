import { randomBytes } from 'node:crypto';
import type { Network } from '@cachet/shared';
import type { KvStore } from '../infra/kv';
import type { VerificationRequestJson, VerifierClient } from '../verify/verifier-client';
import type { BusinessRecord, BusinessRepo } from './repo';

export type ProofErrorCode =
  | 'proof_expired'
  | 'proof_failed'
  | 'proof_wrong_account'
  | 'proof_not_company'
  | 'proof_invalid'
  | 'proof_company_suspended';

export class ProofError extends Error {
  constructor(
    readonly code: ProofErrorCode,
    /** Internal detail for logs; never shown to users. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'ProofError';
  }
}

/** Company identity attributes Cachet asks the wallet to reveal. */
const REVEALED = ['legalName', 'legalCountry'] as const;

const PREFIX = 'proof:company:';
const PROOF_ID_FORMAT = /^[A-Za-z0-9_-]{22}$/;
const CRED_DID = /^did:ccd:(testnet|mainnet):cred:([0-9a-f]{96})$/;

interface StoredRequest {
  account: string;
  request: VerificationRequestJson;
}

export interface CompanyProofDeps {
  kv: KvStore;
  verifier: VerifierClient;
  repo: BusinessRepo;
  network: Network;
  /** Identity provider indexes allowed to vouch for companies (testnet: 4 = Global FinReg). */
  companyIssuers: number[];
  /** Which account owns this credential? (gRPC getAccountInfo by credential id). null if unknown. */
  accountOfCredential: (credIdHex: string) => Promise<string | null>;
  requestTtlSeconds?: number;
  now?: () => number;
}

export interface RevealedCompany {
  legalName: string;
  legalCountry: string;
  issuer: string;
  credId: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read the revealed company attributes out of a verified presentation (JSON).
 * Requires exactly one account-based credential from an allowed company issuer.
 */
export function extractCompany(
  presentation: unknown,
  network: Network,
  allowedIssuers: string[],
): RevealedCompany {
  if (!isObject(presentation) || !Array.isArray(presentation['verifiableCredential'])) {
    throw new ProofError('proof_invalid', 'presentation has no verifiableCredential array');
  }
  const credentials = presentation['verifiableCredential'].filter(isObject);
  const accountCreds = credentials.filter(
    (c) => Array.isArray(c['type']) && c['type'].includes('ConcordiumAccountBasedCredential'),
  );
  const cred = accountCreds[0];
  if (!cred || accountCreds.length !== 1 || credentials.length !== 1) {
    throw new ProofError('proof_invalid', `expected exactly 1 account credential, got ${credentials.length}`);
  }

  const issuer = cred['issuer'];
  if (typeof issuer !== 'string' || !allowedIssuers.includes(issuer)) {
    throw new ProofError('proof_not_company', `issuer ${String(issuer)} is not a company identity provider`);
  }

  const subject = cred['credentialSubject'];
  if (!isObject(subject) || typeof subject['id'] !== 'string') {
    throw new ProofError('proof_invalid', 'missing credentialSubject.id');
  }
  const did = CRED_DID.exec(subject['id']);
  const credId = did?.[2];
  if (!did || did[1] !== network || !credId) {
    throw new ProofError('proof_invalid', `bad credential id ${subject['id']}`);
  }

  const values = new Map<string, string>();
  for (const s of Array.isArray(subject['statement']) ? subject['statement'] : []) {
    if (
      isObject(s) &&
      s['type'] === 'AttributeValue' &&
      typeof s['attributeTag'] === 'string' &&
      typeof s['attributeValue'] === 'string'
    ) {
      values.set(s['attributeTag'], s['attributeValue']);
    }
  }

  const legalName = values.get('legalName')?.trim();
  const legalCountry = values.get('legalCountry')?.trim().toUpperCase();
  if (!legalName || legalName.length > 200 || !legalCountry || !/^[A-Z]{2}$/.test(legalCountry)) {
    throw new ProofError('proof_not_company', 'legalName/legalCountry missing or malformed');
  }
  return { legalName, legalCountry, issuer, credId };
}

export function createCompanyProofService(deps: CompanyProofDeps) {
  const ttl = deps.requestTtlSeconds ?? 10 * 60;
  const now = deps.now ?? Date.now;
  const issuers = deps.companyIssuers.map((i) => `did:ccd:${deps.network}:idp:${i}`);

  /** Step 1: ask the verifier for a proof request (it anchors it on-chain). */
  async function start(account: string): Promise<{ proofId: string; request: VerificationRequestJson }> {
    const proofId = randomBytes(16).toString('base64url');
    const request = await deps.verifier.createRequest({
      connectionId: proofId,
      resourceId: 'cachet:company-proof',
      contextString: 'Prove your company to Cachet',
      // Goes on-chain: keep it free of personal data.
      publicInfo: { app: 'cachet', purpose: 'company-proof' },
      requestedClaims: [
        {
          type: 'identity',
          source: ['accountCredential'],
          issuers,
          statements: REVEALED.map((attributeTag) => ({ type: 'RevealAttribute', attributeTag })),
        },
      ],
    });
    const stored: StoredRequest = { account, request };
    await deps.kv.set(PREFIX + proofId, JSON.stringify(stored), ttl);
    return { proofId, request };
  }

  /** Step 2: verify the wallet's presentation and save the company. */
  async function finish(account: string, proofId: string, presentation: unknown): Promise<BusinessRecord> {
    if (!PROOF_ID_FORMAT.test(proofId)) throw new ProofError('proof_expired');
    // Single use. The request we verify against is OUR stored copy, never one sent by the browser.
    const raw = await deps.kv.take(PREFIX + proofId);
    if (!raw) throw new ProofError('proof_expired');
    const stored = JSON.parse(raw) as StoredRequest;
    if (stored.account !== account) throw new ProofError('proof_expired', 'proof started by another session');

    const response = await deps.verifier.verify({
      auditRecordId: proofId,
      presentation,
      verificationRequest: stored.request,
    });
    if (response.result !== 'verified') {
      const failed = response.result.failed;
      throw new ProofError('proof_failed', `${failed.code}: ${failed.message}`);
    }

    // Read the values from what the service actually verified.
    const verified = response.verificationAuditRecord?.presentation ?? presentation;
    const company = extractCompany(verified, deps.network, issuers);

    // The proof must come from the SAME account that signed in.
    const owner = await deps.accountOfCredential(company.credId);
    if (owner !== account) {
      throw new ProofError(
        'proof_wrong_account',
        `credential belongs to ${owner ?? 'unknown'}, session is ${account}`,
      );
    }

    // Every stored company must point to its on-chain audit record.
    const proofTx = response.anchorTransactionHash;
    if (!proofTx || !/^[0-9a-f]{64}$/i.test(proofTx)) {
      throw new ProofError('proof_failed', 'verifier returned no audit anchor transaction');
    }

    // A suspended company can't start fresh by proving itself again from another account: its
    // suspension, its "never calls" promise and people's blocks all belong to the company.
    const twins = await deps.repo.findByLegalIdentity(company.legalName, company.legalCountry);
    if (twins.some((b) => b.status === 'suspended' && b.concordiumAccount !== account)) {
      throw new ProofError('proof_company_suspended', `${company.legalName} (${company.legalCountry})`);
    }

    return deps.repo.upsertVerified({
      concordiumAccount: account,
      legalName: company.legalName,
      legalCountry: company.legalCountry,
      issuer: company.issuer,
      proofTx: proofTx.toLowerCase(),
      requestTx: stored.request.transactionRef,
      verifiedAt: new Date(now()),
    });
  }

  return { start, finish };
}

export type CompanyProofService = ReturnType<typeof createCompanyProofService>;
