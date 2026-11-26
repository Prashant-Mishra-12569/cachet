'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { lastDays, type DashCall } from '@/lib/dashboard-types';
import { PURPOSES } from '@/lib/tg-types';
import { ExtLink, OutcomeBadge, PeriodPicker, card, money, when, type Period } from './ui';

const csvHref = (p: Period) =>
  `/v1/business/dashboard/export/calls.csv?from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}`;

export function Calls() {
  const [period, setPeriod] = useState<Period>(() => lastDays(30));
  const [calls, setCalls] = useState<DashCall[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (p: Period, cursor: string | null) => {
    const q = new URLSearchParams({ from: p.from, to: p.to, limit: '50' });
    if (cursor) q.set('cursor', cursor);
    return api.get<{ calls: DashCall[]; next: string | null }>(`/v1/business/dashboard/calls?${q}`);
  }, []);

  useEffect(() => {
    let live = true;
    setCalls(null);
    setError(null);
    load(period, null)
      .then((r) => {
        if (!live) return;
        setCalls(r.calls);
        setNext(r.next);
      })
      .catch((e: unknown) => live && setError(e instanceof ApiError ? e.message : 'Could not load calls.'));
    return () => {
      live = false;
    };
  }, [period, load]);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await load(period, next);
      setCalls((c) => [...(c ?? []), ...r.calls]);
      setNext(r.next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load more calls.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PeriodPicker value={period} onChange={setPeriod} />
        <a
          href={csvHref(period)}
          className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-medium hover:bg-bg"
        >
          Download CSV
        </a>
      </div>

      <p className="max-w-[70ch] text-sm text-ink-2">
        People appear as a person code, never a phone number. Cachet doesn&apos;t keep the numbers you call,
        and each company gets its own codes, so they can&apos;t be matched with other companies.
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-alert-soft px-4 py-3 text-alert">
          {error}
        </p>
      ) : calls === null ? (
        <p className="text-sm text-ink-2" aria-live="polite">
          Loading calls…
        </p>
      ) : calls.length === 0 ? (
        <div className={`${card} text-center`}>
          <p className="font-medium">No sealed calls in this period.</p>
          <p className="mt-1 text-sm text-ink-2">Try a longer period, or place a test call from Setup.</p>
        </div>
      ) : (
        <>
          {/* wide screens: a table */}
          <div className={`${card} relative hidden overflow-x-auto p-0 md:block sm:p-0`}>
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">Sealed calls, newest first</caption>
              <thead className="text-ink-2">
                <tr className="border-b border-line">
                  <th scope="col" className="px-5 py-3 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Reason
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Paid
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Record
                  </th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-bg/60">
                    <td className="px-5 py-3 whitespace-nowrap tabular-nums">
                      <a
                        href={c.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block py-3 -my-3 hover:underline"
                      >
                        {when(c.issuedAt)}
                      </a>
                    </td>
                    <td className="px-3 py-3 font-mono text-[13px]">{c.person}</td>
                    <td className="max-w-[28ch] px-3 py-3">
                      <span className="block truncate" title={c.message}>
                        {c.message}
                      </span>
                      <span className="text-[12px] text-ink-2">{PURPOSES[c.purpose] ?? c.purpose}</span>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                      {c.amount ? money(c.amount.value, c.amount.asset, true) : '–'}
                    </td>
                    <td className="px-3 py-3">
                      <OutcomeBadge outcome={c.outcome} text={c.outcomeText} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {c.paid ? (
                        <ExtLink href={c.paid.txUrl}>Paid</ExtLink>
                      ) : (
                        <span className="text-ink-2">–</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {c.record.status === 'finalized' ? (
                        <ExtLink href={c.record.txUrl}>Recorded</ExtLink>
                      ) : (
                        <span className="text-ink-2">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* phones: one card per call */}
          <ul className="flex flex-col gap-3 md:hidden">
            {calls.map((c) => (
              <li key={c.id} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.message}</p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {when(c.issuedAt)} · person <span className="font-mono">{c.person}</span>
                    </p>
                  </div>
                  <OutcomeBadge outcome={c.outcome} text={c.outcomeText} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {c.amount ? <span>{money(c.amount.value, c.amount.asset)}</span> : null}
                  {c.paid ? <ExtLink href={c.paid.txUrl}>Paid</ExtLink> : null}
                  {c.record.status === 'finalized' ? (
                    <ExtLink href={c.record.txUrl}>Recorded on Concordium</ExtLink>
                  ) : (
                    <span className="text-ink-2">Record pending</span>
                  )}
                  <ExtLink href={c.publicUrl}>Seal page</ExtLink>
                </div>
              </li>
            ))}
          </ul>

          {next ? (
            <button
              type="button"
              onClick={more}
              disabled={loadingMore}
              className="mx-auto min-h-11 rounded-full border border-line bg-surface px-6 text-sm font-medium hover:bg-bg disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : 'Load more calls'}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
