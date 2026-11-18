import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Every error the API returns has this shape, with a message a normal person can understand. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

const MESSAGES: Record<string, { status: ContentfulStatusCode; message: string }> = {
  invalid_request: { status: 400, message: 'Something is missing or wrong in the request.' },
  invalid_account: { status: 400, message: "That doesn't look like a Concordium account address." },
  challenge_expired: { status: 400, message: 'This sign-in request expired. Please try again.' },
  challenge_mismatch: {
    status: 400,
    message: 'This sign-in request was made for a different account. Please try again.',
  },
  account_not_found: {
    status: 400,
    message: "We couldn't find this account on Concordium. Is your wallet set to Testnet?",
  },
  bad_signature: { status: 401, message: "The wallet approval didn't match this account. Please try again." },
  not_signed_in: { status: 401, message: 'Please sign in first.' },
  forbidden_origin: { status: 403, message: 'This request must come from the Cachet website.' },
  not_found: { status: 404, message: 'This page does not exist.' },
  rate_limited: { status: 429, message: 'Too many tries. Please wait a few minutes and try again.' },
  chain_unavailable: {
    status: 503,
    message: "We can't reach the Concordium network right now. Please try again shortly.",
  },
  internal: { status: 500, message: 'Something went wrong on our side. Please try again.' },
};

const INTERNAL = {
  status: 500 as ContentfulStatusCode,
  message: 'Something went wrong on our side. Please try again.',
};

export function apiError(c: Context, code: string) {
  const known = MESSAGES[code];
  const entry = known ?? INTERNAL;
  const body: ApiErrorBody = { error: { code: known ? code : 'internal', message: entry.message } };
  return c.json(body, entry.status);
}
