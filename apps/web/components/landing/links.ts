/** Public links used across the landing page. */
export const BOT_USERNAME = process.env['NEXT_PUBLIC_TELEGRAM_BOT_USERNAME'] ?? 'CachetSealBot';
export const BOT_URL = `https://t.me/${BOT_USERNAME}`;
export const REPO_URL = 'https://github.com/Prashant-Mishra-12569/cachet';

/** Sources for the numbers on the page (checked 25 Nov 2026). */
export const SOURCES = {
  fbi: 'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf',
  trai: 'https://www.business-standard.com/industry/news/trai-sees-drop-in-spam-calls-on-network-even-as-customer-complaints-rise-126111301906_1.html',
  hiya: 'https://www.hiya.com/newsroom/press-releases/state-of-the-call-2026-ai-deepfake-voice-calls-hit-1-in-4-americans-as-consumers-say-scammers-are-beating-mobile-network-operators-2-to-1',
} as const;
