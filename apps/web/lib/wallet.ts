import type { WalletApi } from '@concordium/browser-wallet-api-helpers';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';

/** A wallet problem we can explain to the person in plain words. */
export class WalletError extends Error {
  constructor(
    readonly code: 'not_installed' | 'locked' | 'wrong_network' | 'no_account' | 'rejected',
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

/** Ask the wallet to sign a plain-text message. Not a transaction: free and moves nothing. */
export async function signWithWallet(wallet: WalletApi, account: string, message: string) {
  try {
    return await wallet.signMessage(account, message);
  } catch {
    throw new WalletError('rejected', 'You cancelled in your wallet. No problem, try again when ready.');
  }
}
