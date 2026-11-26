'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CachetLogo, WaxSeal } from '@/components/brand/Seal';
import { MARK_PATH } from '@/components/brand/logo-paths';
import { LocalTime } from '@/components/LocalTime';
import { ErrorCard, Skeleton, useTgData } from '@/components/tg/TelegramShell';
import { CodeDigits, Monogram, SafetyNote, SectionTitle, StatusPill } from '@/components/tg/ui';
import { PURPOSES, money, type TgHome } from '@/lib/tg-types';

type Call = TgHome['calls'][number];

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Mini App home: one big answer ("is a verified company calling me now?"), then my calls and family. */
export default function TelegramHome() {
  const { data, error, reload, tg } = useTgData<TgHome>('/me');
  const [checking, setChecking] = useState(false);

  if (error) return <ErrorCard error={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton />;

  const open = data.calls.filter((c) => c.status === 'open');
  const today = data.calls.filter((c) => sameDay(new Date(c.issuedAt), new Date()));
  const earlier = data.calls.filter((c) => !sameDay(new Date(c.issuedAt), new Date()));

  const checkAgain = async () => {
    setChecking(true);
    tg?.HapticFeedback?.impactOccurred?.('light');
    await reload();
    setChecking(false);
  };

  return (
    <>
      <header className="flex items-center justify-between pt-1">
        <CachetLogo className="h-7 w-auto" />
        <span className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2">Testnet</span>
      </header>

      <div className="px-1">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          Hi {data.firstName || 'there'}
        </h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-ink-2">
          <span
            className="grid size-4 place-items-center rounded-full bg-seal text-[10px] text-surface"
            aria-hidden
          >
            ✓
          </span>
          Protected since{' '}
          {new Date(data.protectedSince).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      {open.length > 0 ? (
        open.map((c) => <LiveCall key={c.sealId} call={c} />)
      ) : (
        <section className="tg-card relative overflow-hidden" aria-live="polite">
          <svg
            viewBox="0 0 220 220"
            className="absolute -top-6 -right-6 size-32 rotate-[-8deg] opacity-60"
            aria-hidden
          >
            <path
              d={MARK_PATH}
              fill="none"
              stroke="var(--color-line)"
              strokeWidth="6"
              strokeDasharray="10 9"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-[13px] font-medium text-ink-2">Right now</p>
          <h2 className="mt-1 text-[22px] leading-tight font-semibold">No verified call</h2>
          <p className="mt-2 max-w-[34ch] text-[15px] leading-snug">
            If someone calls now saying they&apos;re a company&apos;s AI,{' '}
            <strong>it isn&apos;t verified</strong>. Don&apos;t pay, don&apos;t share codes, hang up.
          </p>
          <button
            type="button"
            onClick={() => void checkAgain()}
            disabled={checking}
            className="mt-4 min-h-11 rounded-full border border-line bg-bg px-5 text-[15px] font-medium active:scale-[0.98] disabled:opacity-60"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </section>
      )}

      <SectionTitle aside={data.calls.length ? `${data.calls.length} sealed` : undefined}>
        Your calls
      </SectionTitle>
      {data.calls.length === 0 ? (
        <section className="tg-card text-[15px] text-ink-2">
          None yet. When a verified company&apos;s AI calls you, it appears here with its code.
        </section>
      ) : (
        <section className="tg-card p-0 sm:p-0">
          {today.length > 0 && <CallGroup title="Today" calls={today} />}
          {earlier.length > 0 && <CallGroup title="Earlier" calls={earlier} divider={today.length > 0} />}
        </section>
      )}

      <SectionTitle>Family</SectionTitle>
      <section className="tg-card text-[15px]">
        {data.family.protects.length === 0 && data.family.protectedBy.length === 0 ? (
          <>
            <p className="font-medium">Look out for someone you love</p>
            <p className="mt-1 text-ink-2">
              Send <code className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-[13px]">/family Mom</code>{' '}
              in the chat. If they ever check a call that isn&apos;t verified, you get an alert.
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {data.family.protects.length > 0 && (
              <People label="You look out for" names={data.family.protects} />
            )}
            {data.family.protectedBy.length > 0 && (
              <People label="Looking out for you" names={data.family.protectedBy} />
            )}
            <p className="text-[13px] text-ink-2">Change this with /family in the chat.</p>
          </div>
        )}
      </section>

      <SafetyNote />
    </>
  );
}

/** A verified company is on the call right now: the code, big. */
function LiveCall({ call }: { call: Call }) {
  return (
    <Link
      href={`/tg/seal/${call.sealId}`}
      aria-label={`Verified call from ${call.company}. Open details.`}
      className="tg-card relative block overflow-hidden border-seal/30 bg-seal-soft active:scale-[0.99]"
    >
      <WaxSeal
        id={`live-${call.sealId}`}
        className="absolute -top-5 -right-5 size-28 rotate-[-12deg] opacity-90"
      />
      <p className="flex items-center gap-2 text-[13px] font-semibold text-seal">
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-seal opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-seal" />
        </span>
        Verified call right now
      </p>
      <h2 className="mt-1 max-w-[70%] text-[22px] leading-tight font-semibold">{call.company}</h2>
      <p className="mt-0.5 text-[14px] text-ink-2">
        {PURPOSES[call.purpose] ?? call.purpose}
        {call.amount ? ` · ${money(call.amount)}` : ''}
      </p>
      {call.code ? (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-ink-2">Their code</p>
          <CodeDigits code={call.code} />
        </div>
      ) : null}
      <p className="mt-4 text-[14px] leading-snug">
        The AI says this code first. <strong>A different company or code? Hang up.</strong>
      </p>
      <p className="mt-3 text-[14px] font-medium text-seal">
        See details{call.amount ? ' and pay safely' : ''}
      </p>
    </Link>
  );
}

function CallGroup({ title, calls, divider = false }: { title: string; calls: Call[]; divider?: boolean }) {
  return (
    <div className={divider ? 'border-t border-line' : undefined}>
      <p className="px-5 pt-4 text-[12px] font-medium text-ink-2">{title}</p>
      <ul>
        {calls.map((c) => (
          <li key={c.sealId}>
            <Link
              href={`/tg/seal/${c.sealId}`}
              className="flex min-h-16 items-center gap-3 px-5 py-3 active:bg-bg"
            >
              <Monogram name={c.company} live={c.status === 'open'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.company}</span>
                <span className="block truncate text-[13px] text-ink-2">
                  {c.message}
                  {c.amount ? ` · ${money(c.amount)}` : ''}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                  <StatusPill status={c.status} />
                  <LocalTime iso={c.issuedAt} withDate={title !== 'Today'} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function People({ label, names }: { label: string; names: string[] }) {
  return (
    <div>
      <p className="text-[13px] text-ink-2">{label}</p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {names.map((n) => (
          <li key={n} className="flex items-center gap-2 rounded-full bg-bg py-1 pr-3 pl-1">
            <span className="grid size-7 place-items-center rounded-full bg-seal-soft text-[13px] font-semibold text-seal">
              {n.charAt(0).toUpperCase()}
            </span>
            <span className="text-[14px] font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
