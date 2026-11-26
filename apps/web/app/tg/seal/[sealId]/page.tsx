'use client';

import Link from 'next/link';
import { use, type ReactNode } from 'react';
import { WaxSeal } from '@/components/brand/Seal';
import { LocalTime } from '@/components/LocalTime';
import { ErrorCard, Skeleton, useTgData } from '@/components/tg/TelegramShell';
import { CodeDigits, SafetyNote, SectionTitle, StatusPill } from '@/components/tg/ui';
import { countryName } from '@/lib/format';
import { PURPOSES, money, type TgSeal } from '@/lib/tg-types';

/** One sealed call, as the called person sees it: the code, safe payment, and what Cachet checked. */
export default function TelegramSeal({ params }: { params: Promise<{ sealId: string }> }) {
  const { sealId } = use(params);
  const { data: seal, error, reload, tg } = useTgData<TgSeal>(`/seals/${encodeURIComponent(sealId)}`);
  if (error) return <ErrorCard error={error} onRetry={() => void reload()} />;
  if (!seal) return <Skeleton />;

  const open = seal.status === 'open';
  const switchedOff = seal.agent.onChain === 'switched_off' || seal.company.status === 'suspended';
  // Inside Telegram, outside links open in the browser (never inside the Mini App).
  const external = (url: string) => (e: React.MouseEvent) => {
    if (tg) {
      e.preventDefault();
      tg.openLink(url);
    }
  };

  return (
    <>
      <section
        className={`tg-card relative overflow-hidden ${open ? 'border-seal/30 bg-seal-soft' : ''}`}
        aria-label={open ? 'Verified call in progress' : 'Past call'}
      >
        {open ? (
          <WaxSeal id={`seal-${seal.id}`} className="absolute -top-5 -right-5 size-28 rotate-[-12deg]" />
        ) : null}
        <StatusPill status={seal.status} />
        <h1 className="mt-3 max-w-[72%] text-[24px] leading-tight font-semibold tracking-[-0.01em]">
          {seal.company.legalName}
        </h1>
        <p className="mt-0.5 text-[14px] text-ink-2">
          Verified company · {countryName(seal.company.legalCountry)}
        </p>
        <div className="mt-5">
          <p className="mb-2 text-[13px] text-ink-2">{open ? 'Their code' : 'The code was'}</p>
          <CodeDigits code={seal.code} muted={!open} />
        </div>
        {open ? (
          <p className="mt-4 text-[14px] leading-snug">
            The AI says this code at the start of the call.{' '}
            <strong>A different company or code? Hang up.</strong>
          </p>
        ) : null}
      </section>

      {switchedOff && (
        <p role="alert" className="rounded-[18px] bg-alert-soft px-4 py-3 text-[14px] text-alert">
          ⚠️ This AI caller is switched off now. Don&apos;t trust new calls from it.
        </p>
      )}

      {seal.pay && (
        <section className="tg-card">
          <p className="text-[13px] text-ink-2">{seal.paid ? 'Paid' : 'Amount asked'}</p>
          <p className="mt-0.5 text-[30px] leading-tight font-semibold tracking-[-0.02em]">
            {money(seal.pay.amount)}
          </p>
          {seal.paid ? (
            <p className="mt-2 text-[14px]">
              ✅ Paid <LocalTime iso={seal.paid.paidAt} />.{' '}
              <a
                href={seal.paid.txUrl}
                onClick={external(seal.paid.txUrl)}
                className="font-medium text-seal underline"
              >
                Receipt
              </a>
            </p>
          ) : seal.pay.ready ? (
            <>
              <Link
                href={`/tg/pay/${seal.id}`}
                className="mt-4 flex min-h-12 items-center justify-center rounded-full bg-seal px-5 font-medium text-surface active:scale-[0.98]"
              >
                Pay {money(seal.pay.amount).replace(' (test euro)', '')} safely
              </Link>
              <p className="mt-2 text-center text-[13px] text-ink-2">
                Goes only to {seal.pay.company}&apos;s registered wallet. No fee for you.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-ink-2">
              Paying is closed because this call is no longer verified. Don&apos;t pay anyone who asks another
              way.
            </p>
          )}
        </section>
      )}

      <SectionTitle>About this call</SectionTitle>
      <section className="tg-card">
        <dl className="grid gap-3.5 text-[15px]">
          <Row label="AI caller">{seal.agent.name ?? 'AI assistant'}</Row>
          <Row label="Why they called">{PURPOSES[seal.purpose] ?? seal.purpose}</Row>
          <Row label="Message">{seal.message}</Row>
          <Row label="Sealed at">
            <LocalTime iso={seal.issuedAt} />
          </Row>
        </dl>
      </section>

      <SectionTitle>What Cachet checked</SectionTitle>
      <section className="tg-card">
        <ul className="flex flex-col gap-3 text-[15px]">
          <Check ok={seal.company.status === 'active'}>
            Real company, proven on Concordium.{' '}
            <Ext href={seal.company.proofTxUrl} onClick={external(seal.company.proofTxUrl)}>
              Proof
            </Ext>
          </Check>
          <Check ok={seal.agent.onChain === 'active'}>
            Verified AI caller, switched on right now.
            {seal.agent.badgeCheckUrl && (
              <>
                {' '}
                <Ext href={seal.agent.badgeCheckUrl} onClick={external(seal.agent.badgeCheckUrl)}>
                  Check it
                </Ext>
              </>
            )}
          </Check>
          {seal.agent.credential ? (
            <Check
              ok={seal.agent.credential.status === 'active'}
              pending={['unknown', 'not_found', 'not_activated'].includes(seal.agent.credential.status)}
            >
              {seal.agent.credential.status === 'active'
                ? 'Authorised by Cachet (Concordium Web3 ID credential).'
                : seal.agent.credential.status === 'revoked' || seal.agent.credential.status === 'expired'
                  ? "Cachet's authorisation was revoked."
                  : 'Authorisation credential: being checked.'}{' '}
              <Ext
                href={seal.agent.credential.registryUrl}
                onClick={external(seal.agent.credential.registryUrl)}
              >
                Registry
              </Ext>
            </Check>
          ) : null}
          <Check ok={seal.signatureValid}>Signed by Cachet, not changed.</Check>
          <Check ok={seal.anchor.status === 'finalized'} pending={seal.anchor.status !== 'finalized'}>
            {seal.anchor.status === 'finalized' && seal.anchor.txUrl ? (
              <>
                In the permanent public record.{' '}
                <Ext href={seal.anchor.txUrl} onClick={external(seal.anchor.txUrl)}>
                  Record
                </Ext>
              </>
            ) : (
              'Joins the permanent record within a few minutes.'
            )}
          </Check>
        </ul>
      </section>

      <Link
        href="/tg"
        className="flex min-h-11 items-center px-1 text-[14px] font-medium text-ink-2 underline"
      >
        All my calls
      </Link>
      <SafetyNote />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Ext({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="font-medium whitespace-nowrap text-seal underline underline-offset-2"
    >
      {children} ↗
    </a>
  );
}

function Check({ ok, pending = false, children }: { ok: boolean; pending?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-label={ok ? 'Passed' : pending ? 'Pending' : 'Failed'}
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
          ok ? 'bg-seal text-surface' : pending ? 'border border-line text-ink-2' : 'bg-alert text-surface'
        }`}
      >
        {ok ? '✓' : pending ? '…' : '✕'}
      </span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}
