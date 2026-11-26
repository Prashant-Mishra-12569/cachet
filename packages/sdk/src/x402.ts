import { ExactConcordiumScheme } from '@x402/concordium/exact/client';
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import type { AccountAddress, AccountSigner } from '@concordium/web-sdk';

/** Decimal amount ("0.05") → smallest token units as a string, for a token with `decimals` places. */
export function toAtomic(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`Not a valid amount: ${amount}`);
  const [whole = '0', frac = ''] = amount.split('.');
  if (frac.length > decimals) throw new Error(`Too many decimals for this token: ${amount}`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')).toString();
}

/**
 * fetch() for an AI caller that pays x402 "402 Payment Required" answers by itself: it signs a token
 * transfer with its own key (Cachet's facilitator pays the network fee, so the account needs no CCD)
 * and repeats the request. Spend controls: ONLY the given token, at most `maxPerPayment` per payment.
 */
export function createPayingFetch(options: {
  /** CAIP-2 chain id, e.g. "ccd:4221332d34e1694168c2a0c0b3fd0f27" (testnet). */
  network: `${string}:${string}`;
  account: AccountAddress.Type;
  signer: AccountSigner;
  /** The payment token id, e.g. "EUDemo". */
  token: string;
  decimals: number;
  /** Decimal cap per payment, e.g. "0.05". A seal costs 0.01. */
  maxPerPayment: string;
  fetch?: typeof fetch;
}): typeof fetch {
  const client = x402Client.fromConfig({
    schemes: [
      {
        network: options.network,
        client: new ExactConcordiumScheme({ accountAddress: options.account, signer: options.signer }),
      },
    ],
    // By default x402 clients only pay in tokens they know: allow ONLY our token, capped.
    spendControls: {
      allowedAssets: [
        {
          network: options.network,
          asset: options.token,
          maxAmountPerPayment: toAtomic(options.maxPerPayment, options.decimals),
        },
      ],
    },
  });
  return wrapFetchWithPayment(options.fetch ?? fetch, client);
}
