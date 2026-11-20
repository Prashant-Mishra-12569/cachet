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
  checkButton: 'Is this call real?',

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
  sealEnded: (company: string, code: string) =>
    `Call ended.\n<b>${esc(company)}</b>'s verified call is over. (Code was ${formatCode(code)}.)`,
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
    '/privacy: what I store',
    '/stop: delete my data',
    '',
    'I will <b>never</b> ask for OTPs, passwords, card numbers or seed phrases.',
  ].join('\n'),
  privacy:
    '🔒 I store your number only encrypted, plus a secret fingerprint to match calls.\nI never hear or record your calls.\n/stop deletes your data at any time.',
  stopConfirm: 'Delete your data? You will stop getting seal cards.',
  stopYes: 'Delete my data',
  stopNo: 'Keep',
  stopDone: 'Done. Your data is deleted. Come back any time with /start.',
  stopKept: "Nothing changed. You're still protected.",
  notRegistered: "I don't have any data about you.",
  privateOnly: 'I only work in a private chat.',
} as const;
