'use client';

import { use } from 'react';
import { ErrorCard, Skeleton, useTgData } from '@/components/tg/TelegramShell';
import { money, type TgSeal } from '@/lib/tg-types';

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

/**
 * Safe payment (plan §13.2). Shell for now: shows exactly what would be paid, to whom, and where the
 * recipient comes from. The amount and recipient are fixed by the seal and the Agent Registry; the
 * person can't edit them and nobody on the phone can change them. Paying itself comes next.
 */
export default function TelegramPay({ params }: { params: Promise<{ sealId: string }> }) {
  const { sealId } = use(params);
  const { data: seal, error, reload } = useTgData<TgSeal>(`/seals/${encodeURIComponent(sealId)}`);
  if (error) return <ErrorCard error={error} onRetry={() => void reload()} />;
  if (!seal) return <Skeleton />;
  const pay = seal.pay;

  if (!pay) {
    return (
      <section className="tg-card">
        <h1 className="font-semibold">Nothing to pay</h1>
        <p className="mt-1 text-sm text-ink-2">This call didn&apos;t ask for a payment.</p>
      </section>
    );
  }

  return (
    <>
      <section className="tg-card text-center">
        <p className="text-sm text-ink-2">You pay</p>
        <p className="mt-1 text-4xl font-semibold">{money(pay.amount).replace(' (test euro)', '')}</p>
        <p className="mt-1 text-sm text-ink-2">digital euro (test network)</p>
      </section>

      <section className="tg-card text-sm">
        <dl className="grid gap-3">
          <div>
            <dt className="text-ink-2">To</dt>
            <dd className="font-medium">{pay.company}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Their verified wallet</dt>
            <dd className="font-mono">{pay.recipient ? short(pay.recipient) : 'Not confirmed'}</dd>
            <dd className="mt-0.5 text-xs text-ink-2">
              Read live from the Concordium Agent Registry, never from the call.
            </dd>
          </div>
          <div>
            <dt className="text-ink-2">Fee</dt>
            <dd className="font-medium">Free</dd>
          </div>
        </dl>
      </section>

      {pay.ready ? (
        <>
          <button
            type="button"
            disabled
            className="rounded-full bg-seal px-5 py-3 font-medium text-surface opacity-50"
          >
            Pay safely
          </button>
          <p className="px-1 text-center text-xs text-ink-2">
            Paying from here arrives in the next update (test network).
          </p>
        </>
      ) : (
        <p role="alert" className="rounded-2xl bg-alert-soft px-4 py-3 text-sm text-alert">
          ⚠️ Paying is closed: this call is no longer verified, or we couldn&apos;t confirm the company&apos;s
          wallet. Don&apos;t pay anyone who asks another way.
        </p>
      )}
    </>
  );
}
