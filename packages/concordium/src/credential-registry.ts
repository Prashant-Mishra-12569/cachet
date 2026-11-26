import {
  AccountAddress,
  ContractAddress,
  ContractName,
  Energy,
  EntrypointName,
  Parameter,
  ReceiveName,
  ReturnValue,
  serializeInitContractParameters,
  serializeUpdateContractParameters,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';
import { CREDENTIAL_REGISTRY_SCHEMA_BASE64 } from './credential-registry-schema';

export { CREDENTIAL_REGISTRY_MODULE_REF } from './credential-registry-schema';

/**
 * Concordium Web3 ID: Cachet's "Authorised AI Caller" credential registry (CIS-4), an instance of
 * Concordium's own template contract. Cachet is the issuer; each live AI caller holds one credential,
 * keyed by the AI's own Concordium public key. Anyone can read a credential's status on chain.
 */
export const CREDENTIAL_REGISTRY_CONTRACT = 'credential_registry';

const contract = ContractName.fromString(CREDENTIAL_REGISTRY_CONTRACT);
const schemaBuffer = (): ArrayBuffer => {
  const b = Buffer.from(CREDENTIAL_REGISTRY_SCHEMA_BASE64, 'base64');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const hex32 = (h: string, what: string) => {
  if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error(`${what} must be 32 bytes of hex`);
  return h.toLowerCase();
};
const url = (u: string) => ({ url: u, hash: { None: [] } });

export type CredentialStatus = 'active' | 'revoked' | 'expired' | 'not_activated' | 'not_found';

/** Parameters to create the registry (InitContract of the template module). */
export function registryInitParameter(input: {
  issuerMetadataUrl: string;
  credentialType: string;
  schemaUrl: string;
  issuerAccount: string;
  /** Ed25519 public key (hex) that stands behind the credentials: Cachet's seal-signing key. */
  issuerKeyHex: string;
}): Parameter.Type {
  return serializeInitContractParameters(
    contract,
    {
      issuer_metadata: url(input.issuerMetadataUrl),
      credential_type: { credential_type: input.credentialType },
      schema: { schema_ref: url(input.schemaUrl) },
      issuer_account: { Some: [AccountAddress.toBase58(AccountAddress.fromBase58(input.issuerAccount))] },
      issuer_key: hex32(input.issuerKeyHex, 'issuer key'),
      revocation_keys: [],
    },
    schemaBuffer(),
  );
}

/** registerCredential: one credential for one AI caller (holder = its own public key). */
export function registerCredentialParameter(input: {
  holderIdHex: string;
  validFrom: Date;
  metadataUrl: string;
  /** Linked data written with it, e.g. "cachet:agent:<badge>". */
  auxiliary: string;
}): Parameter.Type {
  return serializeUpdateContractParameters(
    contract,
    EntrypointName.fromString('registerCredential'),
    {
      credential_info: {
        holder_id: hex32(input.holderIdHex, 'holder id'),
        holder_revocable: false,
        valid_from: input.validFrom.toISOString(),
        valid_until: { None: [] },
        metadata_url: url(input.metadataUrl),
      },
      auxiliary_data: [...Buffer.from(input.auxiliary, 'utf8')],
    },
    schemaBuffer(),
  );
}

/** revokeCredentialIssuer: Cachet takes the credential back (e.g. the company is suspended). */
export function revokeCredentialParameter(input: { holderIdHex: string; reason: string }): Parameter.Type {
  return serializeUpdateContractParameters(
    contract,
    EntrypointName.fromString('revokeCredentialIssuer'),
    {
      credential_id: hex32(input.holderIdHex, 'credential id'),
      reason: { Some: [{ reason: input.reason.slice(0, 200) }] },
      auxiliary_data: [],
    },
    schemaBuffer(),
  );
}

/** restoreCredential: undo a revocation. */
export function restoreCredentialParameter(input: { holderIdHex: string; reason: string }): Parameter.Type {
  return serializeUpdateContractParameters(
    contract,
    EntrypointName.fromString('restoreCredential'),
    {
      credential_id: hex32(input.holderIdHex, 'credential id'),
      reason: { Some: [{ reason: input.reason.slice(0, 200) }] },
    },
    schemaBuffer(),
  );
}

export const registryEntrypoint = (
  entry: 'registerCredential' | 'revokeCredentialIssuer' | 'restoreCredential',
) => ReceiveName.fromString(`${CREDENTIAL_REGISTRY_CONTRACT}.${entry}`);

/** The status byte returned by credentialStatus (CIS-4): 0 Active, 1 Revoked, 2 Expired, 3 NotActivated. */
export function decodeCredentialStatus(byte: number | undefined): CredentialStatus {
  return (['active', 'revoked', 'expired', 'not_activated'] as const)[byte ?? -1] ?? 'not_found';
}

/** Live status of one credential, read on chain. 'not_found' when it was never registered. */
export async function credentialStatus(
  client: ConcordiumGRPCClient,
  registry: { index: bigint; subindex: bigint },
  holderIdHex: string,
): Promise<CredentialStatus> {
  const result = await client.invokeContract({
    contract: ContractAddress.create(registry.index, registry.subindex),
    method: ReceiveName.fromString(`${CREDENTIAL_REGISTRY_CONTRACT}.credentialStatus`),
    parameter: Parameter.fromHexString(hex32(holderIdHex, 'holder id')),
    energy: Energy.create(30_000),
  });
  if (result.tag !== 'success' || !result.returnValue) return 'not_found';
  return decodeCredentialStatus(ReturnValue.toBuffer(result.returnValue)[0]);
}

/** The AI caller's own public key (credential 0, key 0) on chain: the credential's holder id. */
export async function accountPublicKeyHex(client: ConcordiumGRPCClient, address: string): Promise<string> {
  const info = await client.getAccountInfo(AccountAddress.fromBase58(address));
  const cred = info.accountCredentials[0]?.value.contents as
    { credentialPublicKeys?: { keys: Record<number, { verifyKey: string }> } } | undefined;
  const key = cred?.credentialPublicKeys?.keys[0]?.verifyKey;
  if (!key) throw new Error(`No public key found for account ${address}`);
  return hex32(key, 'account key');
}

/** "<1234,0>" or "1234" → contract address parts. */
export function parseContractAddress(text: string): { index: bigint; subindex: bigint } {
  const m = /^<?\s*(\d+)\s*(?:,\s*(\d+)\s*)?>?$/.exec(text.trim());
  if (!m?.[1]) throw new Error(`Not a contract address: ${text}`);
  return { index: BigInt(m[1]), subindex: BigInt(m[2] ?? '0') };
}
