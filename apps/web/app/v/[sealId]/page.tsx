import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalTime } from '@/components/LocalTime';
import { countryName } from '@/lib/format';
import { getPublicSeal, type PublicSeal } from '@/lib/server-api';
import { CachetLogo } from '@/components/brand/Seal';

type Props = { params: Promise<{ sealId: string }> };

const PURPOSES: Record<string, string> = {
  billing: 'Billing',
  delivery: 'Delivery',
  appointments: 'Appointment',
  support: 'Customer support',
  account_alerts: 'Account alert',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sealId } = await params;
  const seal = await getPublicSeal(sealId).catch(() => null);
  return {
    title: seal ? `Seal from ${seal.company.legalName} · Cachet` : 'Seal not found · Cachet',
    description: 'A Cachet seal: proof that a verified company’s AI caller made this call.',
    // Seal pages are shareable but should not show up in search engines.
    robots: { index: false, follow: false },
  };
}

function statusText(seal: PublicSeal): { label: string; tone: 'seal' | 'neutral' } {
  switch (seal.status) {
    case 'open':
      return { label: 'Call in progress', tone: 'seal' };
    case 'closed':
      return { label: 'Call ended', tone: 'neutral' };
    case 'superseded':
      return { label: 'Replaced by a newer seal', tone: 'neutral' };
    default:
      return { label: 'Seal expired', tone: 'neutral' };
  }
}

/** "EUDemo" is a test euro on testnet: show it as money, honestly labelled. */
function formatAmount(a: { value: string; asset: string }) {
  const euro = /eu/i.test(a.asset);
  return euro ? `€${a.value} (digital euro${a.asset === 'EUDemo' ? ', test' : ''})` : `${a.value} ${a.asset}`;
}

const short = (s: string, n = 10) => `${s.slice(0, n)}…${s.slice(-6)}`;

export default async function SealPage({ params }: Props) {
  const { sealId } = await params;
  const seal = await getPublicSeal(sealId);
  if (!seal) notFound();

  const status = statusText(seal);
  const switchedOff = seal.agent.onChain === 'switched_off' || seal.company.status === 'suspended';
  const anchored = 'proofValid' in seal.anchor && seal.anchor.status === 'finalized';
  const card =
    'rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/.04),0_8px_24px_rgb(0_0_0/.06)] sm:p-6';

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-8 sm:py-14">
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="Cachet home" className="inline-flex min-h-11 items-center">
          <CachetLogo className="h-8 w-auto" />
        </Link>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-2">Testnet</span>
      </header>

      <section className={card} aria-labelledby="seal-title">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
              status.tone === 'seal' ? 'bg-seal-soft text-seal' : 'bg-bg text-ink-2'
            }`}
          >
            {status.tone === 'seal' && <span aria-hidden="true">✓</span>}
            {status.label}
          </span>
          <span className="text-sm text-ink-2">
            <LocalTime iso={seal.issuedAt} />
          </span>
        </div>

        <h1 id="seal-title" className="mt-4 text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
          {seal.company.legalName}
        </h1>
        <p className="mt-1 text-ink-2">Verified company · {countryName(seal.company.legalCountry)}</p>

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-2">AI caller</dt>
            <dd className="mt-0.5 font-medium">{seal.agent.name ?? 'AI assistant'}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Why they called</dt>
            <dd className="mt-0.5 font-medium">{PURPOSES[seal.purpose] ?? seal.purpose}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-2">Message</dt>
            <dd className="mt-0.5 font-medium">{seal.message}</dd>
          </div>
          {seal.amount && (
            <div>
              <dt className="text-ink-2">Amount asked</dt>
              <dd className="mt-0.5 font-medium">{formatAmount(seal.amount)}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink-2">
              {seal.status === 'open' ? 'Seal valid until' : seal.closedAt ? 'Ended' : 'Valid until'}
            </dt>
            <dd className="mt-0.5 font-medium">
              <LocalTime iso={seal.closedAt ?? seal.expiresAt} withDate={false} />
            </dd>
          </div>
        </dl>

        {switchedOff && (
          <p role="alert" className="mt-5 rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert">
            <span aria-hidden="true">⚠️ </span>
            This AI caller has been switched off since this seal was made. Don&apos;t trust new calls from it.
          </p>
        )}
      </section>

      <section className={card} aria-labelledby="checks-title">
        <h2 id="checks-title" className="text-lg font-semibold">
          What Cachet checked
        </h2>
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          <Check ok={seal.company.status === 'active'}>
            <strong>Real company.</strong> Proven with a private proof on Concordium. We only saw its name and
            country.{' '}
            <a
              href={seal.company.proofTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-seal underline"
            >
              Proof record ↗
            </a>
          </Check>
          <Check ok={seal.agent.onChain === 'active'} unknown={seal.agent.onChain === 'unknown'}>
            <strong>Verified AI caller ID.</strong>{' '}
            {seal.agent.onChain === 'active'
              ? 'Registered by this company and switched on right now.'
              : seal.agent.onChain === 'unknown'
                ? "We can't reach Concordium right now to check it live."
                : 'Switched off on Concordium.'}{' '}
            {seal.agent.badgeCheckUrl && (
              <a
                href={seal.agent.badgeCheckUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-seal underline"
              >
                Check it yourself ↗
              </a>
            )}
          </Check>
          <Check ok={seal.signatureValid}>
            <strong>Sealed by Cachet.</strong> The seal is signed and has not been changed.
          </Check>
          <Check ok={anchored} pending={!anchored}>
            <strong>Permanent public record.</strong>{' '}
            {anchored && 'txUrl' in seal.anchor && seal.anchor.txUrl ? (
              <>
                Recorded on Concordium.{' '}
                <a
                  href={seal.anchor.txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-seal underline"
                >
                  View record ↗
                </a>
              </>
            ) : (
              'Will be recorded on Concordium within a few minutes.'
            )}
          </Check>
        </ul>
      </section>

      <section
        className="rounded-[20px] border border-line bg-bg p-5 text-sm sm:p-6"
        aria-labelledby="safety-title"
      >
        <h2 id="safety-title" className="font-semibold">
          Stay safe
        </h2>
        <p className="mt-2 text-ink-2">
          Only trust a call if this seal arrived in <strong className="text-ink">your own</strong> Cachet chat
          on Telegram and the code matches what the caller says. Never trust a link someone sends you, and
          never share OTPs or passwords.
        </p>
        <p className="mt-2 text-ink-2">
          This page is safe to share: it never shows the phone number or the call code.
        </p>
      </section>

      <details className="rounded-[20px] border border-line bg-surface p-5 text-sm sm:p-6">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          For the curious: technical details
        </summary>
        <dl className="mt-4 grid gap-3 font-mono text-xs break-all text-ink-2">
          <Detail label="Seal ID" value={seal.id} />
          <Detail label="Seal fingerprint (SHA-256)" value={seal.sealHash} />
          <Detail label="Signed by key" value={seal.kid} />
          <Detail label="Agent badge" value={seal.agent.badge} />
          <Detail label="Company account" value={short(seal.company.account)} />
          {'proofValid' in seal.anchor && (
            <>
              <Detail label="Record root" value={seal.anchor.root} />
              <Detail
                label={`Inclusion proof (${seal.anchor.proof.length} steps, position ${seal.anchor.leafIndex + 1} of ${seal.anchor.itemCount})`}
                value={seal.anchor.proofValid ? 'valid ✓' : 'INVALID'}
              />
            </>
          )}
        </dl>
        <p className="mt-4 text-ink-2">
          Anyone can check the signature with Cachet&apos;s{' '}
          <a href="/.well-known/cachet-keys.json" className="text-seal underline">
            public key
          </a>
          .
        </p>
      </details>
    </main>
  );
}

function Check({
  ok,
  pending = false,
  unknown = false,
  children,
}: {
  ok: boolean;
  pending?: boolean;
  unknown?: boolean;
  children: React.ReactNode;
}) {
  const icon = ok ? '✓' : pending || unknown ? '…' : '✕';
  const tone = ok
    ? 'bg-seal text-surface'
    : pending || unknown
      ? 'border border-line text-ink-2'
      : 'bg-alert text-surface';
  const label = ok ? 'Passed' : pending ? 'Pending' : unknown ? 'Unknown' : 'Failed';
  return (
    <li className="flex gap-3">
      <span
        aria-label={label}
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs ${tone}`}
      >
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-sans text-ink-2">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
