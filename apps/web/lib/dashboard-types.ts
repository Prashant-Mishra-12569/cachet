/** What /v1/business/dashboard/* returns (mirrors apps/server/src/business/dashboard.ts). */

export type Outcome =
  'in_progress' | 'answered' | 'not_answered' | 'failed' | 'cancelled' | 'blocked' | 'replaced' | 'expired';

export interface Counts {
  total: number;
  answered: number;
  notAnswered: number;
  failed: number;
  cancelled: number;
  blocked: number;
  replaced: number;
  inProgress: number;
  expired: number;
}

export interface DashAgent {
  name: string;
  status: 'draft' | 'registered' | 'active' | 'revoked' | string;
  purposes: string[];
  callingNumbers: string[];
  language: string;
  badge: string | null;
  tokenId: string | null;
  registerTx: string | null;
  registerTxUrl: string | null;
  cardTx: string | null;
  cardTxUrl: string | null;
  agentWallet: string | null;
  badgeCheckUrl: string | null;
}

export interface Summary {
  period: { days: number };
  calls: Counts;
  pickupRate: number | null;
  perDay: { day: string; answered: number; other: number }[];
  payments: { count: number; collected: { asset: string; total: string }[] };
  consents: { granted: number; revoked: number };
  reports: { count: number };
  credits: { left: number; daysLeft: number | null };
  record: { sealed: number; inRecord: number };
  agents: DashAgent[];
  generatedAt: string;
}

export interface DashCall {
  id: string;
  issuedAt: string;
  closedAt: string | null;
  outcome: Outcome;
  outcomeText: string;
  person: string;
  agent: string;
  purpose: string;
  message: string;
  amount: { value: string; asset: string } | null;
  from: string;
  consent: 'granted' | 'none_recorded';
  paid: { txHash: string; txUrl: string } | null;
  record: { status: 'finalized'; txHash: string; txUrl: string } | { status: 'pending' };
  sealHash: string;
  publicUrl: string;
}

export interface DashPayment {
  sealId: string;
  txHash: string;
  txUrl: string;
  payer: string;
  amount: string;
  asset: string;
  paidAt: string;
  publicUrl: string;
}

export interface ComplianceReport {
  network: string;
  generatedAt: string;
  period: { from: string; to: string };
  company: {
    legalName: string;
    legalCountry: string;
    account: string;
    issuer: string;
    verifiedAt: string;
    proofTx: string;
    proofTxUrl: string;
    requestTx: string;
    requestTxUrl: string;
  };
  agents: DashAgent[];
  totals: Counts & { pickupRate: number | null };
  consents: { granted: number; revoked: number };
  reports: number;
  payments: number;
  records: {
    txHash: string | null;
    status: string;
    items: number;
    finalizedAt: string | null;
    txUrl: string | null;
  }[];
  calls: DashCall[];
  callsTruncated: boolean;
}

/** Outcome → a small visual tone (always shown with words, never color alone). */
export const OUTCOME_TONE: Record<Outcome, 'good' | 'neutral' | 'bad' | 'live'> = {
  in_progress: 'live',
  answered: 'good',
  not_answered: 'neutral',
  failed: 'bad',
  cancelled: 'neutral',
  blocked: 'bad',
  replaced: 'neutral',
  expired: 'neutral',
};

/** "2026-11-26" for a Date, in UTC (the server's day boundaries). */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** A period ending today: the last `days` days, inclusive. */
export function lastDays(days: number, now = new Date()): { from: string; to: string } {
  return { from: isoDay(new Date(now.getTime() - (days - 1) * 86_400_000)), to: isoDay(now) };
}
