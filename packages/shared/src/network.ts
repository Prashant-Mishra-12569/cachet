/**
 * Concordium network constants.
 * Values match the ones used by @x402/concordium (checked 16 Nov 2026).
 */

export const NETWORKS = ['testnet', 'mainnet'] as const;
export type Network = (typeof NETWORKS)[number];

export interface NetworkConfig {
  /** CAIP-2 chain id, used in x402 payment requirements and seals. */
  caip2: `ccd:${string}`;
  grpcHost: string;
  grpcPort: number;
  explorerBase: string;
}

export const NETWORK_CONFIG: Readonly<Record<Network, NetworkConfig>> = {
  testnet: {
    caip2: 'ccd:4221332d34e1694168c2a0c0b3fd0f27',
    grpcHost: 'grpc.testnet.concordium.com',
    grpcPort: 20000,
    explorerBase: 'https://ccdexplorer.io/testnet',
  },
  mainnet: {
    caip2: 'ccd:9dd9ca4d19e9393877d2c44b70f89acb',
    grpcHost: 'grpc.mainnet.concordium.software',
    grpcPort: 20000,
    explorerBase: 'https://ccdexplorer.io/mainnet',
  },
};

export function isNetwork(value: unknown): value is Network {
  return typeof value === 'string' && (NETWORKS as readonly string[]).includes(value);
}

const HEX_64 = /^[0-9a-f]{64}$/i;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{50}$/;

/** Link to a transaction on CCDExplorer. */
export function explorerTxUrl(network: Network, txHash: string): string {
  if (!HEX_64.test(txHash)) throw new Error('Transaction hash must be 64 hex characters');
  return `${NETWORK_CONFIG[network].explorerBase}/transaction/${txHash.toLowerCase()}`;
}

/** Link to an account on CCDExplorer. */
export function explorerAccountUrl(network: Network, address: string): string {
  if (!BASE58_ADDRESS.test(address)) throw new Error('Not a Concordium account address');
  return `${NETWORK_CONFIG[network].explorerBase}/account/${address}`;
}
