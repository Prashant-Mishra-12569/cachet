'use client';

import { useState } from 'react';
import { lastDays } from '@/lib/dashboard-types';
import { PeriodPicker, card, type Period } from './ui';

const RULES = [
  {
    rule: 'EU AI Act, Article 50',
    need: 'People must be told they are talking to an AI.',
    proof:
      'Every seal gives your AI its opening sentence, which says it is an AI assistant. The person’s card says so too, before the phone rings.',
  },
  {
    rule: 'EU AI Act, Article 12',
    need: 'Keep records of what the AI system did.',
    proof:
      'Each call is signed and written into a permanent public record that nobody can change afterwards.',
  },
  {
    rule: 'India, TRAI',
    need: 'Commercial calls must come from declared numbers for declared purposes.',
    proof:
      'Your calling numbers and purposes are in your AI caller’s public card, locked by a fingerprint on Concordium. Every call shows who is calling and why before it rings.',
  },
  {
    rule: 'US, FCC',
    need: 'AI-generated voices count as artificial voices; consent and identity matter.',
    proof:
      'Each seal records which company called, from which number, why, and whether the person had allowed your calls.',
  },
];

const q = (p: Period) => `from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}`;

export function Compliance() {
  const [period, setPeriod] = useState<Period>(() => lastDays(30));

  return (
    <div className="flex flex-col gap-5">
      <section className={card}>
        <h2 className="text-lg font-semibold">Export your records</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
          Choose a period, then download the call list for spreadsheets, or open the report and save it as a
          PDF for an auditor. Every line links to a public record, so anyone can check it without trusting
          Cachet.
        </p>
        <div className="mt-4">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={`/business/report?${q(period)}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-medium text-white active:scale-[0.98]"
          >
            Open the compliance report
          </a>
          <a
            href={`/v1/business/dashboard/export/calls.csv?${q(period)}`}
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-medium hover:bg-bg"
          >
            Download CSV
          </a>
        </div>
      </section>

      <section aria-labelledby="rules-title">
        <h2 id="rules-title" className="text-lg font-semibold">
          What your records show
        </h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {RULES.map((r) => (
            <li key={r.rule} className={card}>
              <p className="font-semibold">{r.rule}</p>
              <p className="mt-1 text-sm text-ink-2">{r.need}</p>
              <p className="mt-2 text-[15px]">{r.proof}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 max-w-[70ch] text-sm text-ink-2">
          This helps you show what happened on each call. It is not legal advice, and it doesn&apos;t replace
          your own compliance checks.
        </p>
      </section>
    </div>
  );
}
