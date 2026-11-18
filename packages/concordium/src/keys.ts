import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  AccountAddress,
  buildAccountSigner,
  parseWallet,
  signMessage,
  verifyMessageSignature,
  type AccountSigner,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';
import type { Network } from '@cachet/shared';

export interface LoadedAccountKey {
  address: AccountAddress.Type;
  signer: AccountSigner;
}

export interface LoadKeyOptions {
  /** Path to a Concordium wallet export file (.export). */
  path: string;
  /** The account address this key must belong to. */
  expectedAddress: string;
  network: Network;
  /** Refuse key files located inside this folder (the repository). */
  forbiddenDir?: string | undefined;
}

/** True if `child` is `parent` itself or somewhere inside it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Load a wallet export and check that it belongs to the expected account on the expected network.
 * Errors never contain key material.
 */
export async function loadAccountKey(options: LoadKeyOptions): Promise<LoadedAccountKey> {
  if (options.forbiddenDir && isInside(options.forbiddenDir, options.path)) {
    throw new Error(`Key file must live outside the project folder: ${options.path}`);
  }

  let raw: string;
  try {
    raw = await readFile(options.path, 'utf8');
  } catch {
    throw new Error(`Cannot read key file: ${options.path}`);
  }

  let wallet: ReturnType<typeof parseWallet>;
  try {
    wallet = parseWallet(raw);
  } catch {
    throw new Error(`Not a valid Concordium wallet export: ${options.path}`);
  }

  if (wallet.environment !== options.network) {
    throw new Error(`Key file is for "${wallet.environment}", but CCD_NETWORK is "${options.network}"`);
  }

  const expected = AccountAddress.fromBase58(options.expectedAddress.trim());
  const actual = AccountAddress.fromBase58(wallet.value.address);
  if (!AccountAddress.equals(expected, actual)) {
    throw new Error(
      `Key file belongs to ${AccountAddress.toBase58(actual)}, not ${AccountAddress.toBase58(expected)}`,
    );
  }

  return { address: actual, signer: buildAccountSigner(wallet) };
}

/**
 * Prove the key really controls the account on-chain: sign a throwaway message (not a
 * transaction, costs nothing) and verify it against the account's on-chain public keys.
 */
export async function verifyKeyOnChain(
  client: ConcordiumGRPCClient,
  key: LoadedAccountKey,
): Promise<boolean> {
  const message = `cachet key check ${new Date().toISOString()}`;
  const signature = await signMessage(key.address, message, key.signer);
  const accountInfo = await client.getAccountInfo(key.address);
  return verifyMessageSignature(message, signature, accountInfo);
}
