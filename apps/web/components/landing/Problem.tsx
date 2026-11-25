import { CountUp } from './CountUp';
import { SOURCES } from './links';

const FACTS = [
  {
    figure: <CountUp to={893} prefix="$" suffix="M" />,
    text: 'lost in 2025 to scams that victims tied to AI, in the FBI’s first-ever count of them.',
    source: 'FBI Internet Crime Report 2025',
    href: SOURCES.fbi,
  },
  {
    figure: <CountUp to={22.99} decimals={2} suffix="B" />,
    text: 'suspected spam calls flagged by India’s phone networks in three months (April to June 2026).',
    source: 'TRAI, via Business Standard',
    href: SOURCES.trai,
  },
  {
    figure: <span>1 in 4</span>,
    text: 'Americans say they got a deepfake voice call in the past year.',
    source: 'Hiya, State of the Call 2026',
    href: SOURCES.hiya,
  },
];

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
      <h2
        id="problem-title"
        className="max-w-[22ch] text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
      >
        AI voices made calling cheap for everyone. Including scammers.
      </h2>
      <p className="mt-4 max-w-[60ch] text-lg text-ink-2">
        A bank’s AI assistant and a scammer’s AI now sound the same, and caller ID is easy to fake. People
        stop answering, or answer the wrong caller.
      </p>
      <dl className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {FACTS.map((f) => (
          <div key={f.source} className="border-t border-ink pt-5">
            <dt className="text-[44px] leading-none font-semibold tracking-[-0.03em] sm:text-[56px]">
              {f.figure}
            </dt>
            <dd className="mt-3 text-[17px] leading-relaxed">{f.text}</dd>
            <dd className="mt-1 text-sm">
              <a
                href={f.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink"
              >
                Source: {f.source}
              </a>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
