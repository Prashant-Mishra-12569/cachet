import type { AccountSigner } from '@concordium/web-sdk';
import { toConcordiumFacilitatorSigner } from '@x402/concordium';
import { ExactConcordiumScheme } from '@x402/concordium/exact/facilitator';
import { x402Facilitator } from '@x402/core/facilitator';
import { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
import type { SupportedResponse } from '@x402/core/types';

/**
 * The x402 facilitator: checks a seal payment (the 9 Concordium rules: version, sender, sponsor,
 * recipient, exact amount, token, expiry, sender signature, one operation), adds the sponsor
 * signature, submits it and waits for finality.
 *
 * - local: our own, inside this server; the sponsor account pays the fees. A sponsored transaction
 *   uses the PAYER's nonce, so it never clashes with the sponsor's own anchoring transactions.
 * - hosted: Concordium's hosted testnet facilitator (their account pays the fees).
 */
export type FacilitatorMode = 'local' | 'hosted';

export interface LocalFacilitatorOptions {
  network: `${string}:${string}`;
  sponsor: { address: string; signer: AccountSigner };
  grpc: { host: string; port: number };
}

export function createLocalFacilitator(options: LocalFacilitatorOptions): FacilitatorClient {
  const signer = toConcordiumFacilitatorSigner(options.sponsor.address, options.sponsor.signer, {
    host: options.grpc.host,
    port: options.grpc.port,
    useTls: true,
    network: options.network,
  });
  const facilitator = new x402Facilitator().register(
    options.network,
    new ExactConcordiumScheme({
      signer,
      requireFinalization: true, // credits only for FINALIZED payments
      finalizationTimeoutMs: 60_000,
      maxExpiryOffsetSeconds: 600,
    }),
  );
  return {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    // Same data; the library types its own networks as plain strings here.
    getSupported: async () => facilitator.getSupported() as SupportedResponse,
  };
}

export interface HostedFacilitatorOptions {
  url: string;
  apiKey: string;
  /** How the key is sent (verified against the live service). */
  authHeader: (apiKey: string) => Record<string, string>;
}

export function createHostedFacilitator(options: HostedFacilitatorOptions): FacilitatorClient {
  const headers = options.authHeader(options.apiKey);
  return new HTTPFacilitatorClient({
    url: options.url.replace(/\/+$/, ''),
    timeoutMs: 90_000, // settle waits for finality (~10 s, up to 60 s)
    createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
  });
}
