'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CachetLogo } from '@/components/brand/Seal';
import { Calls } from '@/components/business/Calls';
import { Compliance } from '@/components/business/Compliance';
import { Overview } from '@/components/business/Overview';
import { NeverCalls } from '@/components/business/NeverCalls';
import { ApiKeys } from '@/components/business/ApiKeys';
import { Payments } from '@/components/business/Payments';
import { api, ApiError } from '@/lib/api';
import type { Summary } from '@/lib/dashboard-types';
import { AgentSetup } from './AgentSetup';
import { CompanyProof, type BusinessView } from './CompanyProof';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'calls', label: 'Calls' },
  { id: 'payments', label: 'Payments' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'setup', label: 'Setup' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const isTab = (s: string): s is Tab => TABS.some((t) => t.id === s);
const shortAccount = (a: string) => `${a.slice(0, 6)}…${a.slice(-5)}`;

/** The signed-in company: prove the company first; then the dashboard, with Setup for the AI caller. */
export function BusinessDashboard({ account, onSignOut }: { account: string; onSignOut: () => void }) {
  const [business, setBusiness] = useState<BusinessView | null | undefined>(undefined);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    api
      .get<{ business: BusinessView | null }>('/v1/business/me')
      .then((r) => setBusiness(r.business))
      .catch(() => setBusiness(null));
  }, []);

  const loadSummary = useCallback(() => {
    setSummaryError(null);
    api
      .get<Summary>('/v1/business/dashboard')
      .then(setSummary)
      .catch((e: unknown) =>
        setSummaryError(e instanceof ApiError ? e.message : 'Could not load your dashboard.'),
      );
  }, []);

  useEffect(() => {
    if (business) loadSummary();
  }, [business, loadSummary]);

  // The tab lives in the address (#calls), so Back works and a tab can be bookmarked.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // No tab chosen yet: a live AI caller → Overview; otherwise Setup.
  const live = summary?.agents.some((a) => a.status === 'active') ?? false;
  const current: Tab = tab ?? (summary && !live ? 'setup' : 'overview');
  // On a phone the tab bar scrolls sideways: keep the open tab in view (Setup is the last one).
  useEffect(() => {
    document
      .querySelector('nav[aria-label="Dashboard"] [aria-current="page"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current]);
  const choose = (t: Tab) => {
    window.history.pushState(null, '', `#${t}`);
    setTab(t);
    if (t === 'overview') loadSummary(); // fresh numbers each time
  };

  const header = (
    <header className="border-b border-line bg-surface/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Cachet home" className="inline-flex min-h-11 items-center">
            <CachetLogo className="h-8 w-auto" />
          </Link>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2">Testnet</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-ink-2 sm:inline">
            <span className="font-mono">{shortAccount(account)}</span>
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-11 rounded-full border border-line bg-surface px-4 font-medium hover:bg-bg"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );

  if (business === undefined)
    return (
      <>
        {header}
        <p className="mx-auto max-w-[1200px] px-4 py-10 text-sm text-ink-2 sm:px-6">Loading…</p>
      </>
    );

  // Step 1: prove the company (nothing else makes sense before that).
  if (business === null)
    return (
      <>
        {header}
        <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Cachet</h1>
          <p className="text-ink-2">
            First, prove your company. People will see the name from this proof on every call, so it can never
            be typed in or faked.
          </p>
          <CompanyProof business={null} onProven={setBusiness} />
        </main>
      </>
    );

  return (
    <>
      {header}
      <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-6 pb-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">
            {business.legalName}
          </h1>
        </div>

        <nav aria-label="Dashboard" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-1 rounded-full border border-line bg-surface p-1">
            {TABS.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  aria-current={current === t.id ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    choose(t.id);
                  }}
                  className={`flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium transition-colors ${
                    current === t.id ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {current === 'overview' &&
          (summaryError ? (
            <div role="alert" className="rounded-xl bg-alert-soft px-4 py-3 text-alert">
              {summaryError}{' '}
              <button type="button" onClick={loadSummary} className="ml-2 font-medium underline">
                Try again
              </button>
            </div>
          ) : summary ? (
            <Overview business={business} summary={summary} />
          ) : (
            <p className="text-sm text-ink-2" aria-live="polite">
              Loading your numbers…
            </p>
          ))}
        {current === 'calls' && <Calls />}
        {current === 'payments' && <Payments />}
        {current === 'compliance' && <Compliance />}
        {current === 'setup' && (
          <div className="flex max-w-2xl flex-col gap-6">
            <CompanyProof business={business} onProven={setBusiness} />
            <AgentSetup account={account} />
            <NeverCalls
              business={business}
              hasLiveCaller={
                summary?.agents.some((a) => a.status === 'active' || a.status === 'registered') ?? false
              }
              onChange={setBusiness}
            />
            <ApiKeys />
          </div>
        )}
      </main>
    </>
  );
}
