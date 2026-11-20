/**
 * Print every bot message with example data, for a wording review: `pnpm bot:copy`.
 * Lines that would wrap on a phone are not counted; only real line breaks are.
 * Examples use the demo company (Northwind Energy BV) and test euros.
 */
import { copy } from './copy';

type Copy = typeof copy;

const AMOUNT = { value: '12.40', asset: 'EUDemo' };
const COMPANY = 'Northwind Energy BV';

/** Example arguments for every message that takes some. */
const EXAMPLES: { [K in keyof Copy]?: Copy[K] extends (...args: infer A) => string ? A : never } = {
  sealCard: [{ company: COMPANY, message: 'Your November bill is ready', code: '4721', amount: AMOUNT }],
  payButton: [AMOUNT],
  sealEnded: [COMPANY, '4721'],
  sealEndedBlocked: [COMPANY, '4721'],
  sealExpired: [COMPANY, '4721'],
  sealReplaced: [COMPANY],
  checkGreen: [{ company: COMPANY, code: '4721' }],
  familyInvite: ['Mom', 'https://t.me/CachetSealBot?start=fam_…'],
  familyAsk: ['Asha'],
  familyAllowed: ['Asha'],
  familyGuardianTold: ['Mom'],
  familyList: [['Mom'], ['Raj']],
  familyRemoveButton: ['Mom'],
  familyGuardianLeft: ['Asha'],
  familyWardLeft: ['Mom'],
  guardianAlert: ['Mom'],
  companyNone: ['SBI Bank'],
  companyNeverCalls: ['Demo Exchange (demo)'],
  companyFound: [
    'Northwind Energy BV',
    'NL',
    [{ name: 'Northwind billing assistant', numbers: ['+31201234567'] }],
  ],
  consentLine: [COMPANY, 'revoked'],
  consentBlockButton: [COMPANY],
  consentAllowButton: [COMPANY],
  consentBlocked: [COMPANY, 1],
  consentAllowed: [COMPANY],
};

const plain = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

let long = 0;
for (const [name, value] of Object.entries(copy)) {
  let text: string;
  if (typeof value === 'function') {
    const args = EXAMPLES[name as keyof Copy];
    if (!args) {
      console.log(`\n■ ${name}: (no example yet)`);
      continue;
    }
    text = (value as (...a: unknown[]) => string)(...(args as unknown[]));
  } else {
    text = value;
  }
  const lines = plain(text).split('\n');
  const flag = lines.length > 3 ? `  ← ${lines.length} lines` : '';
  if (flag) long++;
  console.log(`\n■ ${name}${flag}`);
  for (const line of lines) console.log(`  │ ${line}`);
}
console.log(
  `\n${Object.keys(copy).length} messages · ${long} longer than 3 lines (cards and /help are by design).`,
);
