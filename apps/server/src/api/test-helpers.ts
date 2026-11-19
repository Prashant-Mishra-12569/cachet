import { createAuthService, type VerifyMessage } from '../auth/service';
import { createCompanyProofService } from '../business/company-proof';
import { createMemoryBusinessRepo } from '../business/repo';
import { createMemoryKv } from '../infra/kv';
import type { VerifierClient } from '../verify/verifier-client';
import { createApp } from './app';

export const WEB_ORIGIN = 'http://localhost:3000';
/** Real-format testnet addresses (public). */
export const ACCOUNT = '3dt3UMPzRASZndjmKpSWgCP2HhmoxZrgs8FDPtZjNHZzj13hhB';
export const OTHER_ACCOUNT = '35sHhKYuw7zk3iKZZjysLEh8BarcwxAJ4pQcZVB8kT9i4pkB5z';
export const SIGNATURE = { 0: { 0: 'ab'.repeat(64) } };

export const CRED_ID = 'a1'.repeat(48);
export const REQUEST_TX = 'bd45a8d18ff67eba0e018bdd370f55ed6c317cc2a6e0098f29b69881d416096c';
export const AUDIT_TX = 'cc'.repeat(32);

/** A presentation shaped like the verifier's documented example, revealing company attributes. */
export function companyPresentation(
  overrides: { issuer?: string; credId?: string; legalName?: string; legalCountry?: string } = {},
) {
  return {
    type: ['VerifiablePresentation', 'ConcordiumVerifiablePresentationV1'],
    verifiableCredential: [
      {
        type: [
          'VerifiableCredential',
          'ConcordiumVerifiableCredentialV1',
          'ConcordiumAccountBasedCredential',
        ],
        issuer: overrides.issuer ?? 'did:ccd:testnet:idp:4',
        credentialSubject: {
          id: `did:ccd:testnet:cred:${overrides.credId ?? CRED_ID}`,
          statement: [
            {
              type: 'AttributeValue',
              attributeTag: 'legalName',
              attributeValue: overrides.legalName ?? 'Northwind Energy BV',
            },
            {
              type: 'AttributeValue',
              attributeTag: 'legalCountry',
              attributeValue: overrides.legalCountry ?? 'NL',
            },
          ],
        },
      },
    ],
  };
}

/** Fake verifier: records calls, answers "verified" with an audit anchor unless told otherwise. */
export function fakeVerifier(behaviour: { verify?: VerifierClient['verify'] } = {}) {
  const calls = {
    create: [] as Parameters<VerifierClient['createRequest']>[0][],
    verify: [] as Parameters<VerifierClient['verify']>[0][],
  };
  const client: VerifierClient = {
    async createRequest(input) {
      calls.create.push(input);
      return {
        type: 'ConcordiumVerificationRequestV1',
        transactionRef: REQUEST_TX,
        context: {},
        subjectClaims: [],
      };
    },
    async verify(input) {
      calls.verify.push(input);
      if (behaviour.verify) return behaviour.verify(input);
      return {
        result: 'verified',
        verificationAuditRecord: { presentation: input.presentation },
        anchorTransactionHash: AUDIT_TX,
      };
    },
    health: async () => true,
  };
  return { client, calls };
}

export function makeTestApp(
  options: {
    verifyMessage?: VerifyMessage;
    verifier?: VerifierClient;
    /** Who owns a credential on chain. Default: the signed-in test ACCOUNT. */
    accountOfCredential?: (credId: string) => Promise<string | null>;
  } = {},
) {
  const clock = { t: Date.parse('2026-11-19T10:00:00Z') };
  const now = () => clock.t;
  const kv = createMemoryKv(now);
  const repo = createMemoryBusinessRepo();
  const auth = createAuthService({
    kv,
    network: 'testnet',
    webOrigin: WEB_ORIGIN,
    now,
    verifyMessage: options.verifyMessage ?? (async () => ({ ok: true })),
  });
  const companyProof = createCompanyProofService({
    kv,
    verifier: options.verifier ?? fakeVerifier().client,
    repo,
    network: 'testnet',
    companyIssuers: [4],
    accountOfCredential: options.accountOfCredential ?? (async () => ACCOUNT),
    now,
  });
  const app = createApp({
    network: 'testnet',
    version: 'test',
    kv,
    auth,
    repo,
    companyProof,
    webOrigin: WEB_ORIGIN,
    secureCookies: false,
    trustProxy: false,
  });
  return { app, kv, clock, repo };
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

/** Sign in through the real auth routes and return the session cookie. */
export async function signIn(app: ReturnType<typeof makeTestApp>['app'], account = ACCOUNT): Promise<string> {
  const challenge = (await (await app.request(postJson('/v1/auth/challenge', { account }))).json()) as {
    challengeId: string;
  };
  const res = await app.request(
    postJson('/v1/auth/verify', { challengeId: challenge.challengeId, account, signature: SIGNATURE }),
  );
  const match = /cachet_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!match?.[1]) throw new Error('sign-in failed in test');
  return `cachet_session=${match[1]}`;
}
