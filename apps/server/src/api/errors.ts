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
  proof_expired: { status: 400, message: 'This proof request expired. Please start again.' },
  proof_failed: { status: 400, message: "Your wallet's proof couldn't be verified. Please try again." },
  proof_invalid: {
    status: 400,
    message: "Your wallet's proof wasn't in the expected form. Please try again.",
  },
  proof_wrong_account: {
    status: 400,
    message:
      'The proof came from a different account than the one you signed in with. Sign in with your company account and try again.',
  },
  proof_not_company: {
    status: 400,
    message:
      "This account doesn't have a verified company identity. Use an account created with your company identity (Global FinReg).",
  },
  business_not_verified: { status: 403, message: 'Prove your company first, then add your AI caller.' },
  agent_not_found: { status: 404, message: "We couldn't find this AI caller." },
  agent_wrong_state: {
    status: 409,
    message: 'This step is already done or not ready yet. Please refresh the page.',
  },
  number_in_use: {
    status: 409,
    message: 'One of these phone numbers is already used by another verified AI caller.',
  },
  too_many_agents: { status: 409, message: 'You have reached the limit of AI callers for now.' },
  tx_already_used: { status: 409, message: 'That transaction was already used for another step.' },
  tx_not_found: {
    status: 400,
    message: "We couldn't find that transaction on Concordium yet. Please try again in a moment.",
  },
  tx_failed: { status: 400, message: 'That transaction failed on Concordium. Nothing was changed.' },
  tx_mismatch: { status: 400, message: "That transaction doesn't match this step. Please try again." },
  registry_rejected: {
    status: 400,
    message: 'The Concordium Agent Registry would reject this step. Please refresh and try again.',
  },
  registry_mismatch: {
    status: 502,
    message: 'Something looks wrong with the Agent Registry. We stopped for safety.',
  },
  registry_unavailable: {
    status: 503,
    message: "The Concordium Agent Registry isn't reachable right now. Please try again shortly.",
  },
  card_host_unavailable: {
    status: 503,
    message: "We couldn't publish your Agent Card right now. Please try again shortly.",
  },
  card_not_served: {
    status: 503,
    message: 'Your Agent Card was published but is not reachable yet. Please try again in a minute.',
  },
  seal_stale: {
    status: 400,
    message: "This seal request is too old (or from the future). Check the AI caller's clock.",
  },
  seal_replay: { status: 409, message: 'This seal request was already used.' },
  seal_bad_signature: {
    status: 401,
    message: "The AI caller's signature doesn't match its Concordium account.",
  },
  agent_unknown: { status: 404, message: "This AI caller isn't registered and active in Cachet." },
  agent_account_mismatch: { status: 403, message: "This account isn't the AI caller's registered account." },
  agent_revoked: { status: 403, message: 'This AI caller is switched off on Concordium.' },
  agent_card_mismatch: {
    status: 409,
    message: "The Agent Card pinned on Concordium doesn't match Cachet's record.",
  },
  business_suspended: { status: 403, message: 'This company is suspended in Cachet.' },
  number_not_allowed: { status: 400, message: "This calling number isn't registered for this AI caller." },
  purpose_not_allowed: { status: 400, message: "This purpose isn't registered for this AI caller." },
  message_not_allowed: {
    status: 400,
    message: 'The message must be 1–80 characters, with no links and no long numbers.',
  },
  amount_not_allowed: { status: 400, message: 'The amount or currency is not allowed.' },
  invalid_phone: {
    status: 400,
    message: 'Phone numbers must be in international format, like +31201234567.',
  },
  payment_required: { status: 402, message: 'No seal credits left. Buy seal credits and try again.' },
  seal_conflict: {
    status: 409,
    message: 'Another seal for this person was issued at the same moment. Please try again.',
  },
  consent_revoked: {
    status: 403,
    message: 'This person has blocked verified AI calls from your company.',
  },
  seal_not_found: { status: 404, message: "This seal doesn't exist." },
  seal_not_open: { status: 409, message: 'This seal is no longer open.' },
  verifier_unavailable: {
    status: 503,
    message: 'Company verification is temporarily unavailable. Please try again shortly.',
  },
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
