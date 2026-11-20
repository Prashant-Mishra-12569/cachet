'use client';

import Link from 'next/link';
import { LocalTime } from '@/components/LocalTime';
import { ErrorCard, Skeleton, useTgData } from '@/components/tg/TelegramShell';
import { PURPOSES, STATUS_WORDS, money, type TgHome } from '@/lib/tg-types';

/** Mini App home: "is a verified call happening now?" + my recent sealed calls + family. */
export default function TelegramHome() {
  const { data, error, reload } = useTgData<TgHome>('/me');
  if (error) return <ErrorCard error={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton />;

  const open = data.calls.filter((c) => c.status === 'open');

  return (
    <>
      <header className="flex items-center justify-between">
        <span className="font-serif text-2xl italic">Cachet</span>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-2">Testnet</span>
      </header>

      {open.length > 0 ? (
        open.map((c) => (
          <Link
            key={c.sealId}
            href={`/tg/seal/${c.sealId}`}
            className="tg-card block border-seal/40 bg-seal-soft"
            aria-label={`Verified call from ${c.company}, code ${c.code ?? ''}`}
          >
            <p className="text-sm font-medium text-seal">✅ Verified call right now</p>
            <p className="mt-1 text-lg font-semibold">{c.company}</p>
            <p className="mt-3 text-sm text-ink-2">Their code</p>
            <p className="font-mono text-4xl font-semibold tracking-wider">{c.code}</p>
            <p className="mt-3 text-sm">If the caller says a different company or code, it&apos;s a scam.</p>
          </Link>
        ))
      ) : (
        <section className="tg-card">
          <p className="text-sm font-medium text-ink-2">No verified call right now</p>
          <p className="mt-1">
            If someone calls you now saying they are a company&apos;s AI, <strong>it is not verified</strong>.
            Don&apos;t pay, don&apos;t share codes, hang up.
          </p>
        </section>
      )}

      <section className="tg-card" aria-labelledby="calls-title">
        <h2 id="calls-title" className="font-semibold">
          Your sealed calls
        </h2>
        {data.calls.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">
            None yet. When a verified company&apos;s AI calls you, it shows up here.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.calls.map((c) => (
              <li key={c.sealId}>
                <Link href={`/tg/seal/${c.sealId}`} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.company}</span>
                    <span className="block text-sm text-ink-2">
                      {PURPOSES[c.purpose] ?? c.purpose}
                      {c.amount ? ` · ${money(c.amount)}` : ''} · <LocalTime iso={c.issuedAt} />
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${
                      c.status === 'open' ? 'bg-seal-soft text-seal' : 'bg-bg text-ink-2'
                    }`}
                  >
                    {STATUS_WORDS[c.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tg-card text-sm" aria-labelledby="family-title">
        <h2 id="family-title" className="font-semibold">
          Family
        </h2>
        {data.family.protects.length === 0 && data.family.protectedBy.length === 0 ? (
          <p className="mt-2 text-ink-2">
            Protect someone you love: send <code>/family Mom</code> in the chat.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {data.family.protects.length > 0 && <p>You protect: {data.family.protects.join(', ')}</p>}
            {data.family.protectedBy.length > 0 && (
              <p>Protecting you: {data.family.protectedBy.join(', ')}</p>
            )}
            <p className="text-ink-2">Change this with /family in the chat.</p>
          </div>
        )}
      </section>

      <p className="px-1 text-xs text-ink-2">
        Cachet will never ask for OTPs, passwords, card numbers or seed phrases.
      </p>
    </>
  );
}
