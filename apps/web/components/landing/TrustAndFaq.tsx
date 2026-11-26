import Link from 'next/link';
import { SealMark, WaxSeal } from '@/components/brand/Seal';
import { BOT_URL, REPO_URL } from './links';

const PROMISES = [
  {
    title: 'We never hear your calls.',
    body: 'Cachet only knows that a verified company asked to call you.',
  },
  {
    title: 'Your number stays locked.',
    body: 'It is stored only encrypted, plus a secret fingerprint used to match calls. Never in plain text.',
  },
  { title: 'Leave any time.', body: 'Send /stop and everything about you is deleted.' },
];

const RULES = [
  'EU AI Act, Article 50: people must be told when they are talking to an AI. Every sealed call opens by saying so.',
  'India, TRAI: rules against unwanted commercial calls. A sealed call shows who is calling and why before the phone rings.',
  'US, FCC: AI-generated voices count as artificial voices under robocall rules. Each seal is a record of who placed the call.',
];

const FAQ = [
  {
    q: 'Do I need crypto or a wallet to check a call?',
    a: 'No. You only need Telegram. A wallet is needed only if you choose to pay a bill inside a card, and even then the fee is covered.',
  },
  {
    q: 'What if a call has no card?',
    a: 'Treat it as a scam. Hang up, don’t pay, and don’t share any code. If you are not sure, send /check to the Cachet bot while you are on the call.',
  },
  {
    q: 'Could a scammer fake the card?',
    a: 'Cards only come from the Cachet bot, inside your own chat, and only for companies that proved who they are. The code is new for every call. A screenshot, a forwarded message or a link someone sends you is never a card.',
  },
  {
    q: 'Does Cachet listen to my calls?',
    a: 'No. Cachet never hears or records calls. It only knows that a verified company asked to call your number.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing for people. Companies pay €0.01 for each sealed call.',
  },
];

export function Trust() {
  return (
    <section aria-labelledby="trust-title" className="bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2">
        <div>
          <h2
            id="trust-title"
            className="max-w-[18ch] text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
          >
            Built to protect you, not to watch you.
          </h2>
          <ul className="mt-8 space-y-5">
            {PROMISES.map((p) => (
              <li key={p.title} className="flex gap-3">
                <SealMark className="mt-1 size-6 shrink-0" />
                <p className="text-[17px] leading-relaxed">
                  <span className="font-semibold">{p.title}</span>{' '}
                  <span className="text-ink-2">{p.body}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold">Made for the rules on AI calls</h3>
          <ul className="mt-4 space-y-3">
            {RULES.map((r) => (
              <li
                key={r}
                className="rounded-[16px] border border-line px-4 py-3 text-[16px] leading-relaxed text-ink-2"
              >
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[16px] text-ink-2">
            Company identities, AI callers and records live on{' '}
            <a
              href="https://www.concordium.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              Concordium
            </a>
            , a public blockchain with identity built in.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="mx-auto max-w-[860px] px-4 py-20 sm:px-6 sm:py-28">
      <h2
        id="faq-title"
        className="text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
      >
        Questions people ask
      </h2>
      <div className="mt-8 divide-y divide-line border-y border-line">
        {FAQ.map((f) => (
          <details key={f.q} className="group py-1">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              {f.q}
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-ink-2 transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="max-w-[62ch] pb-5 text-[17px] leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="hero-wash relative mx-auto flex max-w-[1200px] flex-col items-start gap-6 overflow-hidden rounded-[32px] border border-line px-6 py-14 sm:px-12 sm:py-20">
        <WaxSeal
          id="closing-seal"
          className="pointer-events-none absolute top-1/2 right-[8%] hidden size-[260px] -translate-y-1/2 rotate-[-12deg] drop-shadow-[0_24px_30px_rgb(15_107_79/0.3)] lg:block"
        />
        <h2 className="max-w-[16ch] text-[34px] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-[56px]">
          No card, no trust.
        </h2>
        <p className="max-w-[48ch] text-lg text-ink-2">
          Open the Cachet bot, share your number once, and every verified AI call to you will announce itself.
        </p>
        <a
          href={BOT_URL}
          className="inline-flex min-h-12 items-center rounded-full bg-seal px-6 font-medium text-white transition-transform active:scale-[0.98]"
        >
          Open Cachet in Telegram
        </a>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 text-[15px] text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <SealMark className="size-6" />
          <span>Cachet. Built by Prashant Mishra. Running on the Concordium test network.</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
          <a href={BOT_URL} className="inline-flex min-h-11 min-w-11 items-center hover:text-ink">
            Telegram bot
          </a>
          <Link href="/business" className="inline-flex min-h-11 min-w-11 items-center hover:text-ink">
            For businesses
          </Link>
          <Link href="/developers" className="inline-flex min-h-11 min-w-11 items-center hover:text-ink">
            Developers
          </Link>
          <Link href="/status" className="inline-flex min-h-11 min-w-11 items-center hover:text-ink">
            Status
          </Link>
          <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="inline-flex min-h-11 min-w-11 items-center hover:text-ink">
            Terms
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center hover:text-ink"
          >
            Source code
          </a>
        </nav>
      </div>
    </footer>
  );
}
