/**
 * On-chain helpers for wallet-signed Agent Registry transactions:
 * load the contract's embedded schema, encode parameters, simulate before signing,
 * and confirm a submitted transaction did exactly what we expected.
 */
import {
  AccountAddress,
  ContractAddress,
  ContractEvent,
  ContractName,
  EntrypointName,
  Energy,
  ModuleReference,
  Parameter,
  ReceiveName,
  TransactionHash,
  getEmbeddedModuleSchema,
  serializeUpdateContractParameters,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';
import { decodeRegistryEvent, type RegistryEvent } from './registry-events';

export interface ContractSchema {
  /** Raw versioned module schema. */
  buffer: ArrayBuffer;
  /** Same, base64: what the browser wallet's sendTransaction expects. */
  base64: string;
}

export async function loadContractSchema(
  client: ConcordiumGRPCClient,
  moduleRefHex: string,
): Promise<ContractSchema> {
  const source = await client.getModuleSource(ModuleReference.fromHexString(moduleRefHex));
  const schema = await getEmbeddedModuleSchema(source);
  if (!schema) throw new Error(`Module ${moduleRefHex} has no embedded schema`);
  return { buffer: schema.buffer, base64: Buffer.from(schema.buffer).toString('base64') };
}

/** Encode schema-JSON parameters exactly as the wallet will (same SDK function). */
export function encodeParameter(
  schema: ContractSchema,
  contractName: string,
  entrypoint: string,
  parameterJson: unknown,
): string {
  const param = serializeUpdateContractParameters(
    ContractName.fromString(contractName),
    EntrypointName.fromString(entrypoint),
    parameterJson,
    schema.buffer,
  );
  return Buffer.from(Parameter.toBuffer(param)).toString('hex');
}

export interface ContractRefInput {
  index: number;
  subindex: number;
}

export type SimulationResult = { ok: true; usedEnergy: bigint } | { ok: false; reason: string };

/** Dry-run a contract update as `invoker` (no signature, no cost). */
export async function simulateUpdate(
  client: ConcordiumGRPCClient,
  input: { invoker: string; contract: ContractRefInput; receiveName: string; parameterHex: string },
): Promise<SimulationResult> {
  const result = await client.invokeContract({
    invoker: AccountAddress.fromBase58(input.invoker),
    contract: ContractAddress.create(input.contract.index, input.contract.subindex),
    method: ReceiveName.fromString(input.receiveName),
    parameter: Parameter.fromHexString(input.parameterHex),
    energy: Energy.create(500_000),
  });
  if (result.tag === 'success') return { ok: true, usedEnergy: result.usedEnergy.value };
  return {
    ok: false,
    reason: JSON.stringify(result.reason, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  };
}

export class TxCheckError extends Error {
  constructor(
    readonly code: 'not_found' | 'failed' | 'wrong_sender' | 'wrong_call' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'TxCheckError';
  }
}

export interface ConfirmedUpdate {
  txHash: string;
  blockHash: string;
  events: RegistryEvent[];
}

/**
 * Wait for a submitted transaction to finalize and check that it is a successful update of
 * `contract.receiveName`, sent by `sender`. Returns the decoded registry events it logged.
 */
export async function confirmContractUpdate(
  client: ConcordiumGRPCClient,
  input: {
    txHash: string;
    sender: string;
    contract: ContractRefInput;
    receiveName: string;
    timeoutMs?: number;
  },
): Promise<ConfirmedUpdate> {
  const hash = TransactionHash.fromHexString(input.txHash);
  let outcome;
  try {
    outcome = await client.waitForTransactionFinalization(hash, input.timeoutMs ?? 90_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(msg)) throw new TxCheckError('not_found', msg);
    throw new TxCheckError('timeout', msg);
  }
  const summary = outcome.summary as unknown as {
    type?: string;
    sender?: AccountAddress.Type;
    transactionType?: string;
    rejectReason?: unknown;
    events?: {
      tag?: string;
      address?: ContractAddress.Type;
      receiveName?: ReceiveName.Type;
      events?: ContractEvent.Type[];
    }[];
  } | null;
  if (!summary || summary.type !== 'accountTransaction')
    throw new TxCheckError('wrong_call', 'not an account transaction');
  if (!summary.sender || AccountAddress.toBase58(summary.sender) !== input.sender) {
    throw new TxCheckError('wrong_sender', 'transaction was not sent by the signed-in account');
  }
  if (summary.transactionType === 'failed') {
    throw new TxCheckError(
      'failed',
      `transaction was rejected: ${JSON.stringify(summary.rejectReason, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
    );
  }
  if (summary.transactionType !== 'update') throw new TxCheckError('wrong_call', 'not a contract update');

  const ours = (summary.events ?? []).filter(
    (e) =>
      e.tag === 'Updated' &&
      e.address !== undefined &&
      e.address.index === BigInt(input.contract.index) &&
      e.address.subindex === BigInt(input.contract.subindex) &&
      e.receiveName !== undefined &&
      ReceiveName.toString(e.receiveName) === input.receiveName,
  );
  if (ours.length === 0)
    throw new TxCheckError('wrong_call', `no ${input.receiveName} call on the registry contract`);

  const events = ours.flatMap((e) =>
    (e.events ?? []).map((raw) => decodeRegistryEvent(ContractEvent.toBuffer(raw))),
  );
  return { txHash: input.txHash.toLowerCase(), blockHash: outcome.blockHash.toString(), events };
}
