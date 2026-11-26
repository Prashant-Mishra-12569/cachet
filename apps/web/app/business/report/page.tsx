'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CachetLogo } from '@/components/brand/Seal';
import { money } from '@/components/business/ui';
import { api, ApiError } from '@/lib/api';
import type { ComplianceReport } from '@/lib/dashboard-types';
import { countryName } from '@/lib/format';
import { PURPOSES } from '@/lib/tg-types';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) +
  ' UTC';
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
/** "did:ccd:testnet:idp:4" → "Concordium identity provider #4". */
const issuerName = (did: string) => {
  const n = /:idp:(\d+)$/.exec(did)?.[1];
  return n ? `Concordium identity provider #${n}` : 'a Concordium identity provider';
};

/**
 * Printable compliance report for one period. "Save as PDF" uses the browser's own print dialog,
 * so the PDF is exactly this page. Every claim links to a public record an auditor can open.
 */
export default function ComplianceReportPage() {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const k of ['from', 'to']) {
      const v = q.get(k);
      if (v) params.set(k, v);
    }
    api
      .get<ComplianceReport>(`/v1/business/dashboard/export/report?${params}`)
      .then(setReport)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401)
          setError('Please sign in to your business account first.');
        else setError(e instanceof ApiError ? e.message : 'Could not build the report.');
      });
  }, []);

  if (error)
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p role="alert" className="rounded-xl bg-alert-soft px-4 py-3 text-alert">
          {error}
        </p>
        <Link href="/business" className="mt-4 inline-flex min-h-11 items-center font-medium underline">
          Go to the business sign-in
        </Link>
      </main>
    );
  if (!report)
    return (
      <p className="px-4 py-16 text-center text-ink-2" aria-live="polite">
        Building your report…
      </p>
    );

  const r = report;
  const lastDay = new Date(new Date(r.period.to).getTime() - 1).toISOString();
  const t = r.totals;
  const th = 'border-b border-ink/20 py-1.5 pr-3 text-left font-semibold';
  const td = 'border-b border-line py-1.5 pr-3 align-top';

  return (
    <div className="bg-bg print:bg-white">
      <div className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-ink-2">Check the report, then save it as a PDF from the print window.</p>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-11 rounded-full bg-ink px-5 text-sm font-medium text-white active:scale-[0.98]"
          >
            Save as PDF
          </button>
        </div>
      </div>

      <article className="mx-auto my-6 max-w-[860px] bg-surface px-6 py-10 text-[14px] leading-relaxed shadow-soft sm:px-12 print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink pb-5">
          <div>
            <CachetLogo className="h-8 w-auto" />
            <h1 className="mt-4 text-[26px] leading-tight font-semibold tracking-[-0.01em]">
              AI calls: compliance report
            </h1>
            <p className="mt-1 text-ink-2">
              {r.company.legalName} · {day(r.period.from)} to {day(lastDay)}
            </p>
          </div>
          <div className="text-right text-[12px] text-ink-2">
            <p>Generated {stamp(r.generatedAt)}</p>
            <p>Concordium {r.network}</p>
          </div>
        </header>

        {r.network !== 'mainnet' && (
          <p className="mt-4 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2">
            Test network: this report covers a demo company and test euros. On mainnet the same report covers
            real calls.
          </p>
        )}

        <Section title="1. Who made the calls">
          <dl className="grid grid-cols-[9.5rem_1fr] gap-x-6 gap-y-1">
            <dt className="text-ink-2">Company</dt>
            <dd className="font-semibold">{r.company.legalName}</dd>
            <dt className="text-ink-2">Country</dt>
            <dd>{countryName(r.company.legalCountry)}</dd>
            <dt className="text-ink-2">How it was verified</dt>
            <dd>
              A private proof from the company&apos;s Concordium identity, issued by{' '}
              {issuerName(r.company.issuer)}{' '}
              <span className="font-mono text-[12px] text-ink-2">({r.company.issuer})</span>, checked on{' '}
              {day(r.company.verifiedAt)}. Only the name and country were revealed.
            </dd>
            <dt className="text-ink-2">Proof record</dt>
            <dd>
              <Tx url={r.company.proofTxUrl} hash={r.company.proofTx} />
            </dd>
          </dl>
          {r.agents.map((a) => (
            <dl key={a.name} className="mt-4 grid grid-cols-[9.5rem_1fr] gap-x-6 gap-y-1">
              <dt className="text-ink-2">AI caller</dt>
              <dd className="font-semibold">
                {a.name} ({a.status === 'active' ? 'switched on' : a.status})
              </dd>
              <dt className="text-ink-2">Calls from</dt>
              <dd>{a.callingNumbers.join(', ') || 'none'}</dd>
              <dt className="text-ink-2">Purposes</dt>
              <dd>{a.purposes.map((p) => PURPOSES[p] ?? p).join(', ')}</dd>
              {a.badge ? (
                <>
                  <dt className="text-ink-2">Registry badge</dt>
                  <dd className="font-mono text-[12px]">{a.badge}</dd>
                </>
              ) : null}
              {a.registerTx && a.registerTxUrl ? (
                <>
                  <dt className="text-ink-2">Registered</dt>
                  <dd>
                    <Tx url={a.registerTxUrl} hash={a.registerTx} />
                  </dd>
                </>
              ) : null}
              {a.cardTx && a.cardTxUrl ? (
                <>
                  <dt className="text-ink-2">Public card fixed</dt>
                  <dd>
                    <Tx url={a.cardTxUrl} hash={a.cardTx} />
                  </dd>
                </>
              ) : null}
            </dl>
          ))}
        </Section>

        <Section title="2. Calls in this period">
          <table className="w-full max-w-md tabular-nums">
            <tbody>
              {(
                [
                  ['Sealed calls', t.total],
                  ['Answered', t.answered],
                  ['Not answered', t.notAnswered],
                  ['Did not connect', t.failed],
                  ['Cancelled', t.cancelled],
                  ['Ended because the person blocked the company', t.blocked],
                  ['Replaced by a newer call', t.replaced],
                  ['Expired without an end signal', t.expired],
                  ['Still in progress', t.inProgress],
                  ['Bills paid inside the call card', r.payments],
                  ['Reports from people about these calls', r.reports],
                  ['Scam calls reported as pretending to be this company', r.impersonations],
                ] as const
              ).map(([label, value]) => (
                <tr key={label}>
                  <td className={td}>{label}</td>
                  <td className={`${td} text-right font-medium`}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-ink-2">
            People&apos;s choices about this company (all time): {r.consents.granted} allowed its calls,{' '}
            {r.consents.revoked} blocked them.
          </p>
        </Section>

        <Section title="3. What the records show">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>EU AI Act, Article 50 (telling people it is an AI).</strong> Every seal gives the AI its
              opening sentence, which says the caller is an AI assistant, and the person&apos;s call card says
              the same before the phone rings.
            </li>
            <li>
              <strong>EU AI Act, Article 12 (keeping records).</strong> Each call is signed by Cachet and
              written into a permanent public record on Concordium (section 4). Records can&apos;t be changed
              afterwards.
            </li>
            <li>
              <strong>India, TRAI (declared commercial calls).</strong> The calling numbers and purposes above
              are in the AI caller&apos;s public card, whose fingerprint is fixed on Concordium.
            </li>
            <li>
              <strong>US, FCC (AI voices, identity and consent).</strong> Each call records the verified
              company, the number it called from, the reason, and whether the person had allowed the
              company&apos;s calls.
            </li>
          </ul>
          <p className="mt-2 text-[13px] text-ink-2">
            This report shows what happened on each call. It is not legal advice and does not replace the
            company&apos;s own compliance checks.
          </p>
        </Section>

        <Section title="4. Permanent public record">
          <p>
            Cachet groups records and writes a fingerprint of each group to Concordium. Each call&apos;s
            public page shows the path from that call to the group&apos;s fingerprint, so anyone can check it
            without trusting Cachet.
          </p>
          {r.records.length === 0 ? (
            <p className="mt-2 text-ink-2">No records in this period yet.</p>
          ) : (
            <table className="mt-3 w-full text-[13px] tabular-nums">
              <thead>
                <tr>
                  <th className={th}>Record transaction</th>
                  <th className={`${th} text-right`}>Items from these calls</th>
                  <th className={th}>Final since</th>
                </tr>
              </thead>
              <tbody>
                {r.records.map((a, i) => (
                  <tr key={a.txHash ?? i}>
                    <td className={td}>
                      {a.txHash && a.txUrl ? <Tx url={a.txUrl} hash={a.txHash} /> : 'pending'}
                    </td>
                    <td className={`${td} text-right`}>{a.items}</td>
                    <td className={td}>{a.finalizedAt ? stamp(a.finalizedAt) : a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="5. Call log">
          <p className="text-ink-2">
            People are shown as a person code, never a phone number: Cachet does not keep the numbers called,
            and each company gets its own codes.
          </p>
          <table className="mt-3 w-full text-[12px] tabular-nums">
            <thead>
              <tr>
                <th className={th}>When (UTC)</th>
                <th className={th}>Person</th>
                <th className={th}>Reason</th>
                <th className={th}>Outcome</th>
                <th className={th}>AI disclosure</th>
                <th className={th}>Consent</th>
                <th className={th}>Record</th>
              </tr>
            </thead>
            <tbody>
              {r.calls.map((c) => (
                <tr key={c.id} className="break-inside-avoid">
                  <td className={`${td} whitespace-nowrap`}>{stamp(c.issuedAt).replace(' UTC', '')}</td>
                  <td className={`${td} font-mono`}>{c.person}</td>
                  <td className={td}>
                    {c.message}
                    {c.amount ? ` (${money(c.amount.value, c.amount.asset, true)})` : ''}
                  </td>
                  <td className={td}>{c.outcomeText}</td>
                  <td className={td}>In seal</td>
                  <td className={td}>{c.consent === 'granted' ? 'Allowed' : 'Not recorded'}</td>
                  <td className={`${td} font-mono`}>
                    {c.record.status === 'finalized' ? (
                      <a href={c.record.txUrl} className="underline">
                        {c.record.txHash.slice(0, 8)}
                      </a>
                    ) : (
                      'pending'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.callsTruncated ? (
            <p className="mt-2 text-ink-2">
              Only the latest {r.calls.length} calls are listed. Download the CSV for the full list.
            </p>
          ) : null}
        </Section>

        <footer className="mt-10 border-t border-line pt-4 text-[12px] text-ink-2">
          Cachet · getcachet.site · Every call above has a public page at getcachet.site/v/&lt;call id&gt;
          with its signature and record proof.
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="mb-3 text-[17px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Tx({ url, hash }: { url: string; hash: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] underline">
      {/* on screen: short; on paper: the full id, so it can be typed into any explorer */}
      <span className="print:hidden">{short(hash)}</span>
      <span className="hidden break-all print:inline">{hash}</span>
    </a>
  );
}
