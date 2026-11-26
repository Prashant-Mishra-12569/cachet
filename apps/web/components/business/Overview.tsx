'use client';

import type { BusinessView } from '@/components/CompanyProof';
import { countryName } from '@/lib/format';
import type { Summary } from '@/lib/dashboard-types';
import { CallsChart } from './CallsChart';
import { ExtLink, Stat, card, money } from './ui';

const nf = new Intl.NumberFormat('en');

export function Overview({ business, summary }: { business: BusinessView; summary: Summary }) {
  const c = summary.calls;
  const agent = summary.agents.find((a) => a.status === 'active') ?? summary.agents[0];
  const collected = summary.payments.collected;
  const rangText = (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`;

  return (
    <div className="flex flex-col gap-5">
      {/* who you are, as people see it */}
      <section className={`${card} grid gap-5 sm:grid-cols-2`} aria-label="Your verified identity">
        <div>
          <p className="text-sm text-ink-2">People see this company name</p>
          <p className="mt-1 text-xl font-semibold">{business.legalName}</p>
          <p className="mt-1 text-sm text-ink-2">
            Verified company · {countryName(business.legalCountry)} ·{' '}
            <ExtLink href={business.proofTxUrl}>proof record</ExtLink>
          </p>
        </div>
        <div>
          <p className="text-sm text-ink-2">Your AI caller</p>
          {agent ? (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold">
                {agent.name}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${
                    agent.status === 'active' ? 'bg-seal-soft text-seal' : 'border border-line text-ink-2'
                  }`}
                >
                  {agent.status === 'active'
                    ? 'Switched on'
                    : agent.status === 'revoked'
                      ? 'Switched off'
                      : 'Not live yet'}
                </span>
              </p>
              <p className="mt-1 text-sm text-ink-2">
                Calls from {agent.callingNumbers.join(', ') || 'no number yet'}
                {agent.badgeCheckUrl ? (
                  <>
                    {' · '}
                    <ExtLink href={agent.badgeCheckUrl}>check the badge</ExtLink>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <p className="mt-1 text-ink-2">Not set up yet. Open Setup to add it.</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          hero
          label={`Calls sealed, last ${summary.period.days} days`}
          value={nf.format(c.total)}
          note={c.inProgress > 0 ? `${c.inProgress} in progress right now` : undefined}
        />
        <Stat
          label="Picked up"
          value={summary.pickupRate === null ? '–' : `${summary.pickupRate}%`}
          note={
            summary.pickupRate === null
              ? 'Shown once calls have rung through.'
              : `${c.answered} of ${rangText(c.answered + c.notAnswered)} that rang through`
          }
        />
        <Stat
          label="Paid inside the card"
          value={collected.length ? collected.map((x) => money(x.total, x.asset, true)).join(' + ') : '€0'}
          note={`${summary.payments.count} ${summary.payments.count === 1 ? 'payment' : 'payments'}, straight to your wallet${
            collected.some((x) => x.asset === 'EUDemo') ? ' (test euro)' : ''
          }`}
        />
        <Stat
          label="Seal credits left"
          value={nf.format(summary.credits.left)}
          note={
            summary.credits.daysLeft === null
              ? '€0.01 each. Your AI buys more by itself.'
              : `About ${nf.format(summary.credits.daysLeft)} days at your current pace`
          }
        />
      </div>

      <section className={card}>
        <CallsChart days={summary.perDay} />
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="People who blocked you"
          value={nf.format(summary.consents.revoked)}
          note={`${summary.consents.granted} chose to allow your calls`}
        />
        <Stat
          label="Scam calls using your name"
          value={nf.format(summary.reports.impersonations)}
          note="People said a caller with no seal claimed to be you. Last 30 days."
        />
        <Stat
          label="Reports about your sealed calls"
          value={nf.format(summary.reports.count)}
          note="Last 30 days"
        />
        <Stat
          label="In the permanent record"
          value={`${nf.format(summary.record.inRecord)} of ${nf.format(summary.record.sealed)}`}
          note="Calls recorded on Concordium. New calls join within about 5 minutes."
        />
      </div>
    </div>
  );
}
