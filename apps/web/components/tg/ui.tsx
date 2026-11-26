'use client';

import type { ReactNode } from 'react';
import type { SealStatus } from '@/lib/tg-types';

/**
 * The call code as big digit tiles ("47-21" → 4 7 – 2 1): easy to compare with what the voice says,
 * even for people who don't see small text well. Screen readers hear "4 7, 2 1".
 */
export function CodeDigits({ code, muted = false }: { code: string; muted?: boolean }) {
  const [a = '', b = ''] = code.split('-');
  const spoken = `${a.split('').join(' ')}, ${b.split('').join(' ')}`;
  const tile = `grid h-[68px] w-[52px] place-items-center rounded-[14px] font-mono text-[38px] font-semibold ${
    muted ? 'border border-line bg-bg text-ink-2' : 'border border-line bg-surface text-ink shadow-soft'
  }`;
  return (
    <div role="img" aria-label={`Code ${spoken}`} className="flex items-center gap-1.5">
      {a.split('').map((d, i) => (
        <span key={`a${i}`} className={tile} aria-hidden>
          {d}
        </span>
      ))}
      <span className="mx-1 h-1 w-3 rounded-full bg-ink-2/60" aria-hidden />
      {b.split('').map((d, i) => (
        <span key={`b${i}`} className={tile} aria-hidden>
          {d}
        </span>
      ))}
    </div>
  );
}

/** A company's first letter in a soft circle (no logos: we never show a brand image we didn't verify). */
export function Monogram({ name, live = false }: { name: string; live?: boolean }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={`grid size-11 shrink-0 place-items-center rounded-full text-[17px] font-semibold ${
        live ? 'bg-seal text-surface' : 'bg-seal-soft text-seal'
      }`}
    >
      {letter}
    </span>
  );
}

const STATUS: Record<SealStatus, { text: string; cls: string }> = {
  open: { text: 'On the call now', cls: 'bg-seal text-surface' },
  closed: { text: 'Ended', cls: 'border border-line text-ink-2' },
  superseded: { text: 'Replaced', cls: 'border border-line text-ink-2' },
  expired: { text: 'Ended', cls: 'border border-line text-ink-2' },
};

export function StatusPill({ status }: { status: SealStatus }) {
  const s = STATUS[status];
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${s.cls}`}>
      {s.text}
    </span>
  );
}

/** The one promise people must remember. */
export function SafetyNote() {
  return (
    <p className="flex items-start gap-2.5 px-1 text-[13px] leading-snug text-ink-2">
      <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0" aria-hidden>
        <path
          fill="currentColor"
          d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4L11 13.2l5.6-5.6L18 9l-7 7Z"
        />
      </svg>
      Cachet never asks for OTPs, passwords, card numbers or seed phrases. Anyone who does is not Cachet.
    </p>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {aside ? <span className="text-[13px] text-ink-2">{aside}</span> : null}
    </div>
  );
}
