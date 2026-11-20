import type { BadgeCheck, BuiltTx, ConfirmedUpdate, OnChainAgent, RegistryEvent } from '@cachet/concordium';
import { createMemoryCardHost, type CardHost } from '../agents/card-host';
import { GatewayError, type RegistryGateway } from '../agents/registry-gateway';
import { createMemoryAgentRepo } from '../agents/repo';
import { createAgentService } from '../agents/service';
import { loadSealSigningKey } from '@cachet/shared/seal';
import { createAuthService, type VerifyMessage } from '../auth/service';
import { createMemoryConsentsRepo } from '../bot/consents-repo';
import { createMemorySealRepo } from '../seals/repo';
import { createSealService } from '../seals/service';
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
    gateway?: RegistryGateway;
    /** Card host; pass null to simulate "not configured". */
    cardHost?: CardHost | null;
    /** Checks the AI's seal-request signatures. Default: accept, and record what was checked. */
    verifyAgentMessage?: VerifyMessage;
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
  const chain = fakeChain();
  const cardHost = options.cardHost === undefined ? createMemoryCardHost() : options.cardHost;
  const agentRepo = createMemoryAgentRepo();
  const agents = createAgentService({
    agents: agentRepo,
    businesses: repo,
    gateway: options.gateway ?? chain.gateway,
    cardHost,
    network: 'testnet',
    servedTimeoutMs: 0,
    sleep: async () => undefined,
  });
  const sealRepo = createMemorySealRepo();
  const consentsRepo = createMemoryConsentsRepo();
  const signingKey = loadSealSigningKey('22'.repeat(32));
  const checkedMessages: { address: string; message: string }[] = [];
  const seals = createSealService({
    seals: sealRepo,
    agents: agentRepo,
    businesses: repo,
    gateway: options.gateway ?? chain.gateway,
    verifyMessage:
      options.verifyAgentMessage ??
      (async (address, message) => {
        checkedMessages.push({ address, message });
        return { ok: true };
      }),
    kv,
    signingKey,
    callCodeSecret: 'test-call-code-secret-0123456789abcdef',
    phonePepper: 'test-phone-pepper-0123456789abcdef',
    network: 'testnet',
    pltTokenId: 'EUDemo',
    webOrigin: WEB_ORIGIN,
    registryUrl: 'https://registry.test',
    consentFor: (phoneHash, businessId) => consentsRepo.statusFor(phoneHash, businessId),
    now,
  });
  const app = createApp({
    network: 'testnet',
    version: 'test',
    kv,
    auth,
    repo,
    companyProof,
    agents,
    seals,
    signingKey,
    registryUrl: 'https://registry.test',
    webOrigin: WEB_ORIGIN,
    secureCookies: false,
    trustProxy: false,
  });
  return {
    app,
    kv,
    clock,
    repo,
    chain,
    cardHost,
    agentRepo,
    sealRepo,
    signingKey,
    checkedMessages,
    consentsRepo,
  };
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

export const REGISTRY = { index: 12802, subindex: 0 };

/**
 * Fake Agent Registry + chain. Tests "submit" transactions with chain.addTx(hash, …); the gateway's
 * confirm() then behaves like the real one (sender + entrypoint checks, decoded events).
 */
export function fakeChain() {
  const txs = new Map<
    string,
    { sender: string; receiveName: string; events: RegistryEvent[]; failed?: boolean }
  >();
  /** Live on-chain agent records, keyed by token id (set by tests). */
  const onChain = new Map<bigint, OnChainAgent>();
  const built = (receiveName: string, parameterJson: unknown): BuiltTx => ({
    contract: REGISTRY,
    receiveName,
    parameterJson,
    parameterHex: '00',
    suggestedEnergy: 30_000,
  });
  const gateway: RegistryGateway = {
    buildRegister: async () => built('CIS-8004.register', { agent_uri: { None: [] } }),
    buildSetAgentUri: async (tokenId, agentUri, metadataHash) =>
      built('CIS-8004.setAgentURI', {
        token_id: tokenId.toString(),
        agent_uri: agentUri,
        metadata_hash: metadataHash,
      }),
    buildCard: async (input) =>
      JSON.stringify(
        {
          name: input.name,
          url: input.agentUri,
          skills: input.skills,
          capabilities: {
            extensions: [
              {
                uri: 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1',
                params: {
                  tokenAddress: `ccd:x/cis-2:JyP9Badge${input.tokenId}`,
                  owner: { account: input.ownerAccount },
                },
              },
            ],
          },
          registrations: [{ agentId: Number(input.tokenId) }],
        },
        null,
        2,
      ),
    tokenAddress: async (tokenId) => `JyP9Badge${tokenId}`,
    toWalletTx: async (b) => ({ ...b, schemaBase64: 'c2NoZW1h', maxEnergy: b.suggestedEnergy }),
    async confirm(txHash, sender, receiveName): Promise<ConfirmedUpdate> {
      const tx = txs.get(txHash);
      if (!tx) throw new GatewayError('tx_not_found', 'unknown tx');
      if (tx.failed) throw new GatewayError('tx_failed', 'rejected');
      if (tx.sender !== sender) throw new GatewayError('tx_mismatch', 'wrong sender');
      if (tx.receiveName !== receiveName) throw new GatewayError('tx_mismatch', 'wrong entrypoint');
      return { txHash, blockHash: 'b'.repeat(64), events: tx.events };
    },
    checkBadge: async (): Promise<BadgeCheck> => ({ badge_valid: true, checks: { status_active: true } }),
    readAgent: async (tokenId) => onChain.get(tokenId) ?? null,
  };
  return {
    gateway,
    onChain,
    addTx(
      hash: string,
      tx: { sender: string; receiveName: string; events: RegistryEvent[]; failed?: boolean },
    ) {
      txs.set(hash, tx);
    },
    registerTx(hash: string, owner: string, tokenId: bigint) {
      txs.set(hash, {
        sender: owner,
        receiveName: 'CIS-8004.register',
        events: [
          { type: 'other', tag: 254 },
          { type: 'Registered', tokenId, owner, agentUri: null, metadataHash: null },
          { type: 'AgentWalletSet', tokenId, wallet: owner },
        ],
      });
    },
    setUriTx(hash: string, owner: string, tokenId: bigint, agentUri: string, metadataHash: string) {
      txs.set(hash, {
        sender: owner,
        receiveName: 'CIS-8004.setAgentURI',
        events: [{ type: 'URIUpdated', tokenId, agentUri, metadataHash }],
      });
    },
  };
}

/** Sign in and prove the company (through the real routes, fake verifier). Returns the cookie. */
export async function signInAsCompany(app: ReturnType<typeof makeTestApp>['app'], account = ACCOUNT) {
  const cookie = await signIn(app, account);
  const started = (await (
    await app.request(postJson('/v1/business/proof/request', {}, { cookie }))
  ).json()) as {
    proofId: string;
  };
  const res = await app.request(
    postJson(
      '/v1/business/proof/verify',
      { proofId: started.proofId, presentation: companyPresentation() },
      { cookie },
    ),
  );
  if (res.status !== 200) throw new Error(`company proof failed in test: ${res.status}`);
  return cookie;
}
