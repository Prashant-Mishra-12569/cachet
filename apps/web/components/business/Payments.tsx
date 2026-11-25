'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { DashPayment } from '@/lib/dashboard-types';
import { ExtLink, card, money, shortId, when } from './ui';

export function Payments() {
  const [list, setList] = useState<DashPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ payments: DashPayment[] }>('/v1/business/dashboard/payments')
      .then((r) => setList(r.payments))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load payments.'));
  }, []);

  if (error)
    return (
      <p role="alert" className="rounded-xl bg-alert-soft px-4 py-3 text-alert">
        {error}
      </p>
    );
  if (!list) return <p className="text-sm text-ink-2">Loading payments…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-sm text-ink-2">
        People paid these bills inside your verified call card. The money can only go to your AI caller&apos;s
        registered wallet, and Cachet paid every network fee. Each receipt is a public record on Concordium.
      </p>
      {list.length === 0 ? (
        <div className={`${card} text-center`}>
          <p className="font-medium">No payments yet.</p>
          <p className="mt-1 text-sm text-ink-2">
            When your AI calls about a bill with an amount, the person gets a &ldquo;Pay safely&rdquo; button.
          </p>
        </div>
      ) : (
        <ul className={`${card} divide-y divide-line p-0 sm:p-0`}>
          {list.map((p) => (
            <li
              key={p.txHash}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4"
            >
              <div>
                <p className="text-lg font-semibold tabular-nums">{money(p.amount, p.asset)}</p>
                <p className="text-sm text-ink-2">
                  {when(p.paidAt)} · from <span className="font-mono">{shortId(p.payer)}</span>
                </p>
              </div>
              <div className="flex gap-4 text-sm">
                <ExtLink href={p.publicUrl}>The call</ExtLink>
                <ExtLink href={p.txUrl}>Receipt on Concordium</ExtLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
