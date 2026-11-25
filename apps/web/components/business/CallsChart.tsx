'use client';

import { useState } from 'react';

type Day = { day: string; answered: number; other: number };

/** Colors validated for contrast (≥ 3:1) and color-blind separation. Grey = "everything else". */
const ANSWERED = '#0F6B4F';
const OTHER = '#8C867C';

/** 1, 2, 5 × 10ⁿ: a clean top for the axis. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

/**
 * Sealed calls per day: answered (green, at the baseline) and every other outcome (grey) stacked
 * on top. Each day is a focusable button; hover or focus shows its numbers.
 */
export function CallsChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(1, ...days.map((d) => d.answered + d.other)));
  const ticks = [0, top / 2, top];
  const total = days.reduce((s, d) => s + d.answered + d.other, 0);

  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <figcaption className="text-[15px] font-semibold">Sealed calls, last 14 days</figcaption>
        <ul className="flex gap-4 text-sm text-ink-2" aria-label="Legend">
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: ANSWERED }} aria-hidden />
            Answered
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: OTHER }} aria-hidden />
            Other outcomes
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        {/* y axis */}
        <div className="relative h-40 w-6 text-right text-[11px] text-ink-2 tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${100 - (t / top) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>

        {/* plot */}
        <div className="relative h-40" role="group" aria-label={`Sealed calls per day, ${total} in 14 days`}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-line"
              style={{ top: `${100 - (t / top) * 100}%` }}
              aria-hidden
            />
          ))}
          <div className="absolute inset-0 flex">
            {days.map((d, i) => {
              const sum = d.answered + d.other;
              const label = `${dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.answered} answered, ${d.other} other`;
              return (
                <button
                  key={d.day}
                  type="button"
                  aria-label={label}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group relative flex flex-1 items-end justify-center rounded-md focus-visible:outline-offset-0"
                >
                  {/* hover band */}
                  <span
                    className={`absolute inset-0 rounded-md transition-colors ${active === i ? 'bg-ink/[0.04]' : ''}`}
                    aria-hidden
                  />
                  {sum > 0 && (
                    <span
                      className="relative flex w-[min(24px,60%)] flex-col justify-end gap-[2px]"
                      style={{ height: `${(sum / top) * 100}%` }}
                      aria-hidden
                    >
                      {d.other > 0 && (
                        <span
                          className="w-full rounded-t-[4px]"
                          style={{ flexGrow: d.other, background: OTHER }}
                        />
                      )}
                      {d.answered > 0 && (
                        <span
                          className={`w-full ${d.other > 0 ? '' : 'rounded-t-[4px]'}`}
                          style={{ flexGrow: d.answered, background: ANSWERED }}
                        />
                      )}
                    </span>
                  )}
                  {active === i && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-[10px] bg-night px-3 py-2 text-left text-[13px] leading-snug text-white shadow-soft"
                    >
                      <span className="block font-medium">
                        {dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="block text-white/80">
                        {d.answered} answered · {d.other} other
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* x axis: every other day, to stay readable on phones */}
        <div />
        <div className="mt-1.5 flex text-[11px] text-ink-2" aria-hidden>
          {days.map((d, i) => (
            <span key={d.day} className="flex-1 text-center tabular-nums">
              {i % 2 === (days.length - 1) % 2 ? dayLabel(d.day, { day: 'numeric', month: 'short' }) : ''}
            </span>
          ))}
        </div>
      </div>

      <details className="text-sm">
        <summary className="flex min-h-11 w-fit cursor-pointer items-center font-medium text-ink-2 hover:text-ink">
          Show the numbers
        </summary>
        <table className="mt-2 w-full max-w-md text-left tabular-nums">
          <thead className="text-ink-2">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Answered</th>
              <th className="py-1 text-right font-medium">Other</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1">
                  {dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}
                </td>
                <td className="py-1 text-right">{d.answered}</td>
                <td className="py-1 text-right">{d.other}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
