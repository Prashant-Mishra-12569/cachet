import type { SmartContractParameters, WalletApi } from '@concordium/browser-wallet-api-helpers';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';

/** A wallet problem we can explain to the person in plain words. */
export class WalletError extends Error {
  constructor(
    readonly code: 'not_installed' | 'locked' | 'wrong_network' | 'no_account' | 'rejected' | 'outdated',
    message: string,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export const WALLET_SETUP_URL =
  'https://docs.concordium.com/en/mainnet/technical-reference/wallets/guides/setup-wallets-lp.html';

/** Find the Concordium Wallet browser extension. Loaded on demand to keep the page light. */
async function getWallet(): Promise<WalletApi> {
  const { detectConcordiumProvider } = await import('@concordium/browser-wallet-api-helpers');
  try {
    return await detectConcordiumProvider(2_000);
  } catch {
    throw new WalletError('not_installed', "We couldn't find the Concordium Wallet in this browser.");
  }
}

/** The wallet reports a genesis hash; the CAIP-2 id is its first 32 hex characters. */
function chainMatches(genesisHash: string, network: Network): boolean {
  const expected = NETWORK_CONFIG[network].caip2.slice('ccd:'.length);
  return genesisHash.toLowerCase().startsWith(expected);
}

/** Connect to the wallet, check it is on the right network, and return the chosen account. */
export async function connectWallet(network: Network): Promise<{ wallet: WalletApi; account: string }> {
  const wallet = await getWallet();

  let accounts: string[];
  try {
    accounts = await wallet.requestAccounts();
  } catch {
    throw new WalletError('rejected', 'You cancelled the connection in your wallet. Try again when ready.');
  }

  const chain = await wallet.getSelectedChain();
  if (!chain) throw new WalletError('locked', 'Unlock your Concordium Wallet and try again.');
  if (!chainMatches(chain, network)) {
    const name = network === 'testnet' ? 'Testnet' : 'Mainnet';
    throw new WalletError(
      'wrong_network',
      `Your wallet is on another network. Switch it to ${name} and try again.`,
    );
  }

  const account = (await wallet.getMostRecentlySelectedAccount()) ?? accounts[0];
  if (!account) {
    throw new WalletError('no_account', 'Connect at least one account in your wallet, then try again.');
  }
  return { wallet, account };
}

/**
 * Ask the wallet for a zero-knowledge proof (Verify & Access, V1 request from our server).
 * The extension serializes the request itself, so the server's JSON is passed through as-is,
 * and the returned presentation is sent back as JSON (it has toJSON()).
 */
export async function requestProof(network: Network, requestJson: unknown): Promise<unknown> {
  const { wallet } = await connectWallet(network);
  if (typeof wallet.requestVerifiablePresentationV1 !== 'function') {
    throw new WalletError(
      'outdated',
      'Please update your Concordium Wallet to the latest version and try again.',
    );
  }
  let presentation: unknown;
  try {
    presentation = await wallet.requestVerifiablePresentationV1(
      requestJson as Parameters<typeof wallet.requestVerifiablePresentationV1>[0],
    );
  } catch {
    throw new WalletError('rejected', 'The proof was cancelled in your wallet. Try again when ready.');
  }
  return JSON.parse(JSON.stringify(presentation)) as unknown;
}

/** A contract update prepared (and pre-checked) by the Cachet server. */
export interface WalletTx {
  contract: { index: number; subindex: number };
  receiveName: string;
  parameterJson: unknown;
  schemaBase64: string;
  maxEnergy: number;
}

/**
 * Ask the wallet to approve and send a smart-contract transaction from `expectedAccount`.
 * The wallet encodes the parameter with the contract's schema. Returns the transaction hash.
 */
export async function sendContractUpdate(
  network: Network,
  expectedAccount: string,
  tx: WalletTx,
): Promise<string> {
  const { wallet, account } = await connectWallet(network);
  if (account !== expectedAccount) {
    throw new WalletError(
      'no_account',
      'Your wallet has a different account selected. Select the account you signed in with and try again.',
    );
  }
  // Small value types only (no WebAssembly), loaded on demand.
  const { AccountTransactionType, CcdAmount, ContractAddress, Energy, ReceiveName } =
    await import('@concordium/web-sdk/types');
  try {
    return await wallet.sendTransaction(
      account,
      AccountTransactionType.Update,
      {
        amount: CcdAmount.zero(),
        address: ContractAddress.create(tx.contract.index, tx.contract.subindex),
        receiveName: ReceiveName.fromString(tx.receiveName),
        maxContractExecutionEnergy: Energy.create(tx.maxEnergy),
      },
      tx.parameterJson as SmartContractParameters,
      tx.schemaBase64,
    );
  } catch {
    throw new WalletError('rejected', 'The transaction was cancelled in your wallet. Nothing was sent.');
  }
}

/** Ask the wallet to sign a plain-text message. Not a transaction: free and moves nothing. */
export async function signWithWallet(wallet: WalletApi, account: string, message: string) {
  try {
    return await wallet.signMessage(account, message);
  } catch {
    throw new WalletError('rejected', 'You cancelled in your wallet. No problem, try again when ready.');
  }
}
