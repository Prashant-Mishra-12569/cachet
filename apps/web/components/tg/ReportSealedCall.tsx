'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useTelegram } from './TelegramShell';

const REASONS = [
  { id: 'pressure', label: 'They pressured me or were rude' },
  { id: 'suspicious_request', label: 'They asked for codes, passwords or an odd payment' },
  { id: 'not_who_they_said', label: "They didn't seem to be this company" },
  { id: 'other', label: 'Something else felt wrong' },
] as const;

/**
 * Report a verified call that still felt wrong. Only the person who got the call can, once.
 * Enough reports from different people suspend the company automatically.
 */
export function ReportSealedCall({ sealId }: { sealId: string }) {
  const telegram = useTelegram();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'already'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async (category: string) => {
    if (!telegram) return;
    setState('sending');
    setError(null);
    try {
      const r = await api.post<{ alreadyReported: boolean }>(
        `/v1/tg/seals/${sealId}/report`,
        { category },
        { authorization: `tma ${telegram.initData}` },
      );
      telegram.tg.HapticFeedback?.notificationOccurred('success');
      setState(r.alreadyReported ? 'already' : 'done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your report. Please try again.');
      setState('idle');
    }
  };

  if (state === 'done' || state === 'already') {
    return (
      <section className="tg-card" aria-live="polite">
        <p className="font-semibold">
          {state === 'done' ? 'Thanks, your report is saved.' : 'You already reported this call.'}
        </p>
        <p className="mt-1 text-[14px] text-ink-2">
          If many different people report a company, Cachet suspends it and its calls stop being verified.
        </p>
      </section>
    );
  }

  return (
    <section className="tg-card">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center justify-between text-left text-[15px] font-medium"
          aria-expanded={false}
        >
          <span>Did this verified call feel wrong?</span>
          <span className="text-alert">Report it</span>
        </button>
      ) : (
        <>
          <p className="font-semibold">What happened?</p>
          <ul className="mt-3 flex flex-col gap-2">
            {REASONS.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={state === 'sending'}
                  onClick={() => void send(r.id)}
                  className="flex min-h-12 w-full items-center rounded-[14px] border border-line bg-bg px-4 text-left text-[15px] active:scale-[0.99] disabled:opacity-60"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 min-h-11 text-[14px] text-ink-2 underline"
          >
            Cancel
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-alert-soft px-3 py-2 text-[14px] text-alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
