/** Shapes returned by the Mini App API (/v1/tg/*). */

export type SealStatus = 'open' | 'closed' | 'superseded' | 'expired';
export interface Amount {
  value: string;
  asset: string;
}

export interface TgHome {
  firstName: string;
  protectedSince: string;
  calls: {
    sealId: string;
    company: string;
    purpose: string;
    message: string;
    amount: Amount | null;
    status: SealStatus;
    issuedAt: string;
    /** Only while the call is open. */
    code: string | null;
  }[];
  family: { protects: string[]; protectedBy: string[] };
}

export interface TgSeal {
  id: string;
  status: SealStatus;
  signatureValid: boolean;
  company: {
    legalName: string;
    legalCountry: string;
    proofTxUrl: string;
    status: 'active' | 'suspended' | 'unknown';
  };
  agent: {
    name: string | null;
    onChain: 'active' | 'switched_off' | 'unknown';
    badgeCheckUrl: string | null;
  };
  purpose: string;
  message: string;
  amount: Amount | null;
  issuedAt: string;
  expiresAt: string;
  closedAt: string | null;
  code: string;
  anchor: { status: string; txUrl?: string };
  pay: {
    amount: Amount;
    company: string;
    recipient: string | null;
    fee: 'free';
    ready: boolean;
  } | null;
  paid: { txHash: string; txUrl: string; paidAt: string } | null;
}

export interface TgPrepared {
  /** Sponsored transaction JSON for the wallet (Transaction.signableFromJSON). */
  transaction: string;
  expiresAt: string;
  amount: Amount;
  company: string;
  recipient: string;
  sender: string;
}

export interface TgPaid {
  status: 'paid';
  txHash: string;
  txUrl: string;
  paidAt: string;
}

export const PURPOSES: Record<string, string> = {
  billing: 'Billing',
  delivery: 'Delivery',
  appointments: 'Appointment',
  support: 'Customer support',
  account_alerts: 'Account alert',
};

/** EUDemo is a test euro: show it as money, honestly labelled. */
export function money(a: Amount) {
  return /eu/i.test(a.asset)
    ? `€${a.value}${a.asset === 'EUDemo' ? ' (test euro)' : ''}`
    : `${a.value} ${a.asset}`;
}

export const STATUS_WORDS: Record<SealStatus, string> = {
  open: 'Call in progress',
  closed: 'Call ended',
  superseded: 'Replaced by a newer call',
  expired: 'Ended',
};
