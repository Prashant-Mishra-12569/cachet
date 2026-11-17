import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';

export interface GrpcOptions {
  network: Network;
  /** Override host (e.g. a self-hosted node). Defaults to the public node for the network. */
  host?: string | undefined;
  port?: number | undefined;
  /** Request timeout in ms. */
  timeoutMs?: number | undefined;
}

/** Create a TLS gRPC client for a Concordium node. Server-side only. */
export function createGrpcClient(options: GrpcOptions): ConcordiumGRPCNodeClient {
  const defaults = NETWORK_CONFIG[options.network];
  return new ConcordiumGRPCNodeClient(
    options.host ?? defaults.grpcHost,
    options.port ?? defaults.grpcPort,
    credentials.createSsl(),
    { timeout: options.timeoutMs ?? 15_000 },
  );
}
