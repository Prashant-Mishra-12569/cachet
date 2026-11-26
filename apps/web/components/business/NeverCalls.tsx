'use client';

import { useState } from 'react';
import type { BusinessView } from '@/components/CompanyProof';
import { api, ApiError } from '@/lib/api';
import { card } from './ui';

/**
 * "We never make AI calls": for companies like exchanges and banks that never phone people with an AI.
 * Any call claiming to be them is then shown as a scam. Locked while an AI caller is live.
 */
export function NeverCalls({
  business,
  hasLiveCaller,
  onChange,
}: {
  business: BusinessView;
  hasLiveCaller: boolean;
  onChange: (b: BusinessView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = business.neverCalls;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ business: BusinessView }>('/v1/business/never-calls', { neverCalls: !on });
      onChange(r.business);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change this. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-labelledby="never-calls-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="never-calls-title" className="text-lg font-semibold">
          We never make AI calls
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${
            on ? 'bg-alert-soft text-alert' : 'border border-line text-ink-2'
          }`}
        >
          {on ? 'On' : 'Off'}
        </span>
      </div>
      <p className="mt-1 max-w-[62ch] text-[15px] text-ink-2">
        {on
          ? `Cachet tells people that ${business.legalName} never makes AI calls. When someone reports a call claiming to be you, they're told it's a scam.`
          : 'For companies that never phone people with an AI. When it is on, anyone who reports a call claiming to be you is told straight away that it is a scam.'}
      </p>
      <p className="mt-2 text-sm text-ink-2">Each change is written to your permanent public record.</p>
      {hasLiveCaller && !on ? (
        <p className="mt-3 rounded-xl bg-bg px-4 py-3 text-sm text-ink-2">
          You have an AI caller that is live, so this can&apos;t be turned on.
        </p>
      ) : (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="mt-4 min-h-11 rounded-full border border-line bg-surface px-5 text-sm font-medium hover:bg-bg disabled:opacity-60"
        >
          {busy ? 'Saving…' : on ? 'Turn off' : 'Turn on: we never make AI calls'}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
