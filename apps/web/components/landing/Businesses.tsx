import Link from 'next/link';

const BENEFITS = [
  {
    title: 'People pick up again',
    body: 'Your call arrives with your verified name and a code before the phone even rings. No more “is this a scam?”',
  },
  {
    title: 'Get paid on the call',
    body: 'Customers pay the bill inside the card, straight into your registered wallet. Nobody can redirect the money.',
  },
  {
    title: 'Proof for regulators',
    body: 'Every call carries an AI disclosure and leaves a permanent, checkable record, without storing anyone’s number in plain text.',
  },
];

/** The real SDK call, shortened. Each line is [kind, text] pieces so indentation is exact. */
type Piece = ['k' | 's' | 'c' | 't', string];
const CODE: Piece[][] = [
  [['c', '// right before your AI dials']],
  [
    ['k', 'const'],
    ['t', ' seal = '],
    ['k', 'await'],
    ['t', ' cachet.sealCall({'],
  ],
  [
    ['t', '  to: '],
    ['s', "'+31612345678'"],
    ['t', ','],
  ],
  [
    ['t', '  from: '],
    ['s', "'+31201234567'"],
    ['t', ','],
  ],
  [
    ['t', '  purpose: '],
    ['s', "'billing'"],
    ['t', ','],
  ],
  [
    ['t', '  message: '],
    ['s', "'Your November bill is ready'"],
    ['t', ','],
  ],
  [['t', '});']],
  [],
  [['c', '// the first thing your AI says']],
  [['t', 'agent.say(seal.firstLine);']],
  [['c', '// “Hi, this is Northwind Energy BV’s AI assistant.']],
  [['c', '//  Your Cachet code is four-seven, two-one.”']],
];
const TONE = { k: 'text-[#c792ea]', s: 'text-[#a5e3b8]', c: 'text-white/45', t: '' } as const;

function Snippet() {
  return (
    <pre className="overflow-x-auto rounded-[22px] bg-night p-5 text-[13.5px] leading-[1.7] text-white/90 sm:p-6 sm:text-[14.5px]">
      <code className="font-mono">
        {CODE.map((line, i) => (
          <span key={i} className="block min-h-[1.7em] whitespace-pre">
            {line.map(([kind, text], j) => (
              <span key={j} className={TONE[kind]}>
                {text}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function Businesses() {
  return (
    <section aria-labelledby="biz-title" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="min-w-0">
          <h2
            id="biz-title"
            className="max-w-[18ch] text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
          >
            For companies: prove it’s really you.
          </h2>
          <ul className="mt-8 space-y-6">
            {BENEFITS.map((b) => (
              <li key={b.title} className="border-l-2 border-seal pl-4">
                <h3 className="text-lg font-semibold">{b.title}</h3>
                <p className="mt-1 max-w-[52ch] text-[17px] leading-relaxed text-ink-2">{b.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-lg">
            <span className="font-semibold">€0.01 per sealed call.</span>{' '}
            <span className="text-ink-2">Your AI pays per call, by itself. No subscription.</span>
          </p>
          <Link
            href="/business"
            className="mt-6 inline-flex min-h-12 items-center rounded-full bg-ink px-6 font-medium text-white transition-transform active:scale-[0.98]"
          >
            Verify your company
          </Link>
        </div>
        <div className="min-w-0">
          <Snippet />
          <p className="mt-3 text-sm text-ink-2">
            Works with the voice AI you already run. Setup is a few approvals in your Concordium wallet.
          </p>
        </div>
      </div>
    </section>
  );
}
