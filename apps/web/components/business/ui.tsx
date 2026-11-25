'use client';

import type { ReactNode } from 'react';
import { OUTCOME_TONE, lastDays, type Outcome } from '@/lib/dashboard-types';

export const card =
  'rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/.04),0_8px_24px_rgb(0_0_0/.06)] sm:p-6';

/** EUDemo is a test euro: money, honestly labelled. */
export function money(value: string, asset: string, short = false) {
  if (!/eu/i.test(asset)) return `${value} ${asset}`;
  return asset === 'EUDemo' && !short ? `€${value} (test euro)` : `€${value}`;
}

export const shortId = (s: string, head = 6, tail = 4) => `${s.slice(0, head)}…${s.slice(-tail)}`;

export function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A number with its label. The value uses proportional figures (it stands alone). */
export function Stat({
  label,
  value,
  note,
  hero = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  hero?: boolean;
}) {
  return (
    <div className={`${card} flex flex-col gap-1`}>
      <p className="text-sm text-ink-2">{label}</p>
      <p
        className={`font-semibold tracking-[-0.02em] ${hero ? 'text-[48px] leading-none' : 'text-[32px] leading-tight'}`}
      >
        {value}
      </p>
      {note ? <p className="mt-1 text-sm leading-snug text-ink-2">{note}</p> : null}
    </div>
  );
}

const TONE_CLASS = {
  good: 'bg-seal-soft text-seal',
  live: 'bg-seal text-white',
  neutral: 'bg-bg text-ink-2 border border-line',
  bad: 'bg-alert-soft text-alert',
} as const;

/** Outcome as words + a tone (never color alone). */
export function OutcomeBadge({ outcome, text }: { outcome: Outcome; text: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap ${TONE_CLASS[OUTCOME_TONE[outcome]]}`}
    >
      {text}
    </span>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export type Period = { from: string; to: string };

const PRESETS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/** Period picker: three quick choices + exact dates. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const isPreset = (d: number) => {
    const p = lastDays(d);
    return p.from === value.from && p.to === value.to;
  };
  const input =
    'min-h-11 rounded-[12px] border border-line bg-surface px-3 text-[15px] tabular-nums focus-visible:outline-2 focus-visible:outline-seal';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Quick period"
        className="flex rounded-full border border-line bg-surface p-1"
      >
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            aria-pressed={isPreset(p.days)}
            onClick={() => onChange(lastDays(p.days))}
            className={`min-h-11 rounded-full px-3.5 text-sm font-medium transition-colors ${
              isPreset(p.days) ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        From
        <input
          type="date"
          className={input}
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        to
        <input
          type="date"
          className={input}
          value={value.to}
          min={value.from}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
        />
      </label>
    </div>
  );
}
