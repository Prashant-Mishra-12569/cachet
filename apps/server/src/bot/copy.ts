/**
 * Every message the bot sends (plan §11). Rules: ~3 short lines, at most one emoji (✅ ⚠️ 🔒),
 * no tech words, never ask for OTPs / passwords / card numbers / seed phrases.
 * All variable text goes through esc() (HTML parse mode).
 */
import { formatCode } from '@cachet/shared/seal';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "EUDemo" is a test euro: show it as money, honestly labelled. */
export const money = (a: { value: string; asset: string }) =>
  /eu/i.test(a.asset) ? `€${a.value}${a.asset === 'EUDemo' ? ' (test euro)' : ''}` : `${a.value} ${a.asset}`;

export const copy = {
  welcome: 'Hi! I tell you if an AI call is really from a company, or a scam.\nShare your number to begin.',
  shareButton: 'Share my number',
  notOwnContact:
    'Please use the button below to share <b>your own</b> number.\nI can only protect the number of this Telegram account.',
  protected:
    "🔒 You're protected.\nWhen a verified company's AI calls you, I'll send a green card here.\n<b>No card? Treat it as a scam.</b>",
  needNumber: 'Share your number first, then I can check calls for you.',

  sealCard: (s: {
    company: string;
    message: string;
    code: string;
    amount?: { value: string; asset: string };
  }) =>
    [
      '✅ <b>Verified call</b>',
      `<b>${esc(s.company)}</b> is calling you with an AI assistant.`,
      `Reason: ${esc(s.message)}`,
      ...(s.amount ? [`Amount: ${esc(money(s.amount))}`] : []),
      `Your code: <b>${formatCode(s.code)}</b>`,
    ].join('\n'),
  payButton: (amount: { value: string; asset: string }) =>
    `Pay ${money(amount).replace(' (test euro)', '')} safely`,
  menuButton: 'Open Cachet',
  paid: (amount: { value: string; asset: string }, company: string) =>
    `✅ Paid ${esc(money(amount))} to <b>${esc(company)}</b>.\nNo fee for you: Cachet covered it.`,
  receiptButton: 'Receipt ↗',
  sealEnded: (company: string, code: string) =>
    `Call ended.\n<b>${esc(company)}</b>'s verified call is over. (Code was ${formatCode(code)}.)`,
  sealEndedBlocked: (company: string, code: string) =>
    `Ended. You blocked <b>${esc(company)}</b>, so this call is no longer verified. (Code was ${formatCode(code)}.)`,
  sealExpired: (company: string, code: string) =>
    `Ended. This seal from <b>${esc(company)}</b> has expired. (Code was ${formatCode(code)}.)`,
  sealReplaced: (company: string) => `Replaced by a newer call from <b>${esc(company)}</b>.`,

  checkGreen: (s: { company: string; code: string }) =>
    `✅ <b>${esc(s.company)}</b> has a verified call to you right now.\nTheir code: <b>${formatCode(s.code)}</b>\nIf the caller says a different company or code, it's a scam.`,
  checkRed:
    "⚠️ <b>Not verified</b>\nNo verified company is calling you right now.\nDon't pay. Don't share OTPs. Hang up.",
  reportButton: 'Report this call',
  reported: "Thanks. Your report is saved. Stay safe: don't pay and don't share codes.",
  tooManyChecks: 'Too many checks in a short time. Please wait a few minutes.',

  help: [
    'I check AI phone calls for you.',
    '/check: Is this call real?',
    '/history: my sealed calls',
    '/company: is a company verified?',
    '/consent: who may call me',
    '/family: protect someone you love',
    '/privacy: what I store · /stop: delete my data',
    '',
    'I will <b>never</b> ask for OTPs, passwords, card numbers or seed phrases.',
  ].join('\n'),
  privacy:
    '🔒 I store your number only encrypted, plus a secret fingerprint to match calls.\nI never hear or record your calls.\n/stop deletes everything: your number, family links and allow/block choices.',
  stopConfirm: 'Delete your data? You will stop getting seal cards.',
  stopYes: 'Delete my data',
  stopNo: 'Keep',
  stopDone: 'Done. Your data is deleted. Come back any time with /start.',
  stopKept: "Nothing changed. You're still protected.",
  notRegistered: "I don't have any data about you.",
  privateOnly: 'I only work in a private chat.',

  // /family
  familyHelp:
    'Protect someone you love.\nSend /family and their name, like: <code>/family Mom</code>\nThey say yes in their own Telegram.',
  familyLabelBad: 'Please use a short name (1–30 letters), like: <code>/family Mom</code>',
  familyLimit: 'You can protect up to 5 people.',
  familyInvite: (label: string, link: string) =>
    `Send this link to <b>${esc(label)}</b>:\n${esc(link)}\nWhen they open it and tap Allow, I'll alert you if they're ever on an unverified call. The link works once, for 24 hours.`,
  familyAsk: (guardianName: string) =>
    `<b>${esc(guardianName)}</b> wants an alert if you're ever on an unverified call.\nThey won't see your calls or your number. Allow?`,
  familyAllow: 'Allow',
  familyDecline: 'No thanks',
  familyAllowed: (guardianName: string) =>
    `Done. <b>${esc(guardianName)}</b> will get an alert if you're ever on an unverified call.\nRemove it any time with /family.`,
  familyGuardianTold: (label: string) =>
    `✅ <b>${esc(label)}</b> said yes. I'll alert you if they're ever on an unverified call.`,
  familyDeclined: 'OK, nothing is shared.',
  familyInviteGone: 'This invite link has expired or was already used. Ask for a new one.',
  familySelf: "That's your own invite link. Send it to the person you want to protect.",
  familyAlready: "You're already linked.",
  familyList: (protects: string[], protectedBy: string[]) =>
    [
      protects.length ? `You protect: ${protects.map((n) => `<b>${esc(n)}</b>`).join(', ')}` : '',
      protectedBy.length ? `Protecting you: ${protectedBy.map((n) => `<b>${esc(n)}</b>`).join(', ')}` : '',
      'Add someone: <code>/family Mom</code>',
    ]
      .filter(Boolean)
      .join('\n'),
  familyRemoveButton: (name: string) => `Remove ${name}`,
  familyRemoved: 'Removed.',
  familyGuardianLeft: (guardianName: string) =>
    `<b>${esc(guardianName)}</b> no longer gets alerts about your calls.`,
  familyWardLeft: (label: string) => `<b>${esc(label)}</b> stopped sharing call alerts with you.`,
  guardianAlert: (label: string) =>
    `⚠️ <b>${esc(label)}</b> just checked a call that is NOT verified.\nYou may want to call them now.`,

  // /history
  historyEmpty: 'No sealed calls yet.',
  historyTitle: 'Your last sealed calls:',

  // /company
  companyAsk: 'Send /company and a name, like: <code>/company Northwind</code>',
  companyNone: (q: string) =>
    `I don't know a verified company called "${esc(q)}".\nTreat AI calls claiming to be them as not verified.`,
  companyNeverCalls: (name: string) =>
    `⚠️ <b>${esc(name)}</b> has told Cachet it never makes AI calls.\nAny AI call claiming to be them is a scam.`,
  companyFound: (name: string, country: string, callers: { name: string; numbers: string[] }[]) =>
    [
      `✅ <b>${esc(name)}</b> (${esc(country)}) is a verified company.`,
      callers.length
        ? `Verified AI callers: ${callers.map((c) => `${esc(c.name)} (calls from ${c.numbers.map(esc).join(', ')})`).join('; ')}`
        : 'It has no verified AI callers.',
    ].join('\n'),

  // /consent
  consentEmpty: 'No company has sealed a call to you yet. When one does, you can allow or block it here.',
  consentTitle: 'Who may call you with a verified AI caller:',
  consentLine: (name: string, status: 'granted' | 'revoked' | null) =>
    `• <b>${esc(name)}</b>: ${status === 'granted' ? 'allowed' : status === 'revoked' ? 'blocked' : 'not set'}`,
  consentBlockButton: (name: string) => `Block ${name}`,
  consentAllowButton: (name: string) => `Allow ${name}`,
  consentBlocked: (name: string, endedCalls = 0) =>
    [
      `Blocked. <b>${esc(name)}</b>'s AI callers can no longer get a seal to call you.`,
      ...(endedCalls > 0 ? ['Their open verified call to you is now ended.'] : []),
      'Changed your mind? Tap Allow above.',
    ].join('\n'),
  consentAllowed: (name: string) =>
    `Allowed. Seals from <b>${esc(name)}</b> will now say you agreed to their calls.`,
} as const;

const PURPOSE_WORDS: Record<string, string> = {
  billing: 'Billing',
  delivery: 'Delivery',
  appointments: 'Appointment',
  support: 'Support',
  account_alerts: 'Account alert',
};
export const purposeWord = (p: string) => PURPOSE_WORDS[p] ?? p;

/** "just now", "5 min ago", "3 h ago", "2 days ago": no timezone needed. */
export function ago(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
