'use client';

import Link from 'next/link';
import { use } from 'react';
import { LocalTime } from '@/components/LocalTime';
import { ErrorCard, Skeleton, useTgData } from '@/components/tg/TelegramShell';
import { countryName } from '@/lib/format';
import { PURPOSES, STATUS_WORDS, money, type TgSeal } from '@/lib/tg-types';

/** One sealed call, as the called person sees it: the code, what was checked, and safe payment. */
export default function TelegramSeal({ params }: { params: Promise<{ sealId: string }> }) {
  const { sealId } = use(params);
  const { data: seal, error, reload, tg } = useTgData<TgSeal>(`/seals/${encodeURIComponent(sealId)}`);
  if (error) return <ErrorCard error={error} onRetry={() => void reload()} />;
  if (!seal) return <Skeleton />;

  const open = seal.status === 'open';
  const switchedOff = seal.agent.onChain === 'switched_off' || seal.company.status === 'suspended';
  const external = (url: string) => (e: React.MouseEvent) => {
    // Inside Telegram, open outside links in the browser (never inside the Mini App).
    if (tg) {
      e.preventDefault();
      tg.openLink(url);
    }
  };

  return (
    <>
      <section className={`tg-card ${open ? 'border-seal/40 bg-seal-soft' : ''}`}>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
            open ? 'bg-surface text-seal' : 'bg-bg text-ink-2'
          }`}
        >
          {open ? '✅ ' : ''}
          {STATUS_WORDS[seal.status]}
        </span>
        <h1 className="mt-3 text-2xl leading-tight font-semibold">{seal.company.legalName}</h1>
        <p className="text-sm text-ink-2">Verified company · {countryName(seal.company.legalCountry)}</p>

        <p className="mt-4 text-sm text-ink-2">{open ? 'Their code' : 'The code was'}</p>
        <p className={`font-mono font-semibold tracking-wider ${open ? 'text-5xl' : 'text-2xl text-ink-2'}`}>
          {seal.code}
        </p>
        {open && (
          <p className="mt-3 text-sm">
            The AI says this code at the start of the call. Different code or company? It&apos;s a scam.
          </p>
        )}
      </section>

      {switchedOff && (
        <p role="alert" className="rounded-2xl bg-alert-soft px-4 py-3 text-sm text-alert">
          ⚠️ This AI caller is switched off now. Don&apos;t trust new calls from it.
        </p>
      )}

      {seal.pay && (
        <section className="tg-card">
          <p className="text-sm text-ink-2">Amount asked</p>
          <p className="text-2xl font-semibold">{money(seal.pay.amount)}</p>
          {seal.pay.ready ? (
            <Link
              href={`/tg/pay/${seal.id}`}
              className="mt-4 block rounded-full bg-seal px-5 py-3 text-center font-medium text-surface"
            >
              Pay {money(seal.pay.amount).replace(' (test euro)', '')} safely
            </Link>
          ) : (
            <p className="mt-3 text-sm text-ink-2">
              Paying is closed: this call is no longer verified. Don&apos;t pay anyone who asks another way.
            </p>
          )}
        </section>
      )}

      <section className="tg-card text-sm">
        <dl className="grid gap-3">
          <Row label="AI caller">{seal.agent.name ?? 'AI assistant'}</Row>
          <Row label="Why they called">{PURPOSES[seal.purpose] ?? seal.purpose}</Row>
          <Row label="Message">{seal.message}</Row>
          <Row label="Sealed at">
            <LocalTime iso={seal.issuedAt} />
          </Row>
        </dl>
      </section>

      <section className="tg-card text-sm" aria-labelledby="checks">
        <h2 id="checks" className="font-semibold">
          What Cachet checked
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          <Check ok={seal.company.status === 'active'}>
            Real company, proven on Concordium.{' '}
            <a
              href={seal.company.proofTxUrl}
              onClick={external(seal.company.proofTxUrl)}
              className="text-seal underline"
            >
              Proof ↗
            </a>
          </Check>
          <Check ok={seal.agent.onChain === 'active'}>
            Verified AI caller, switched on right now.
            {seal.agent.badgeCheckUrl && (
              <>
                {' '}
                <a
                  href={seal.agent.badgeCheckUrl}
                  onClick={external(seal.agent.badgeCheckUrl)}
                  className="text-seal underline"
                >
                  Check ↗
                </a>
              </>
            )}
          </Check>
          <Check ok={seal.signatureValid}>Signed by Cachet, not changed.</Check>
          <Check ok={seal.anchor.status === 'finalized'} pending={seal.anchor.status !== 'finalized'}>
            {seal.anchor.status === 'finalized' && seal.anchor.txUrl ? (
              <>
                Permanent public record.{' '}
                <a
                  href={seal.anchor.txUrl}
                  onClick={external(seal.anchor.txUrl)}
                  className="text-seal underline"
                >
                  Record ↗
                </a>
              </>
            ) : (
              'Permanent record: added within a few minutes.'
            )}
          </Check>
        </ul>
      </section>

      <Link href="/tg" className="px-1 text-sm text-ink-2 underline">
        All my sealed calls
      </Link>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Check({
  ok,
  pending = false,
  children,
}: {
  ok: boolean;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-label={ok ? 'Passed' : pending ? 'Pending' : 'Failed'}
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${
          ok ? 'bg-seal text-surface' : pending ? 'border border-line text-ink-2' : 'bg-alert text-surface'
        }`}
      >
        {ok ? '✓' : pending ? '…' : '✕'}
      </span>
      <span>{children}</span>
    </li>
  );
}
