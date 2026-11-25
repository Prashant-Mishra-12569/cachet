import { LocalTime } from '@/components/LocalTime';
import type { PublicStats } from '@/lib/server-api';

const nf = new Intl.NumberFormat('en');

/**
 * Real numbers from the running system, straight from Cachet's database and Concordium testnet.
 * Totals only: no people, no codes, no single call.
 */
export function LiveRecord({ stats }: { stats: PublicStats | null }) {
  return (
    <section aria-labelledby="live-title" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-end">
        <div>
          <h2
            id="live-title"
            className="max-w-[18ch] text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
          >
            Running now, in public.
          </h2>
          <p className="mt-4 max-w-[52ch] text-lg text-ink-2">
            Every seal goes into a permanent public record on Concordium. These numbers come from the live
            system on the Concordium test network, with a demo company and test euros.
          </p>
        </div>

        {stats ? (
          <div className="rounded-[28px] bg-night p-6 text-white sm:p-8">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-7">
              <Figure value={stats.sealsTotal} label="calls sealed" />
              <Figure value={stats.sealsInPublicRecord} label="already in the permanent record" />
              <Figure value={stats.paymentsTotal} label="bills paid inside a card" />
              <Figure value={stats.sealsLast24h} label="calls sealed in the last 24 hours" />
            </dl>
            {stats.lastRecord ? (
              <p className="mt-8 border-t border-white/15 pt-5 text-[15px] leading-relaxed text-white/75">
                Latest record: {stats.lastRecord.items} {stats.lastRecord.items === 1 ? 'item' : 'items'},
                written on <LocalTime iso={stats.lastRecord.at} />.{' '}
                <a
                  href={stats.lastRecord.txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-white underline decoration-white/40 underline-offset-4 hover:decoration-white"
                >
                  See it on the Concordium explorer
                </a>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="rounded-[28px] border border-line bg-surface p-6 text-ink-2">
            The live numbers can’t be loaded right now. Every seal page still links to its public record.
          </p>
        )}
      </div>
    </section>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums sm:text-[52px]">
        {nf.format(value)}
      </dd>
      <dd className="mt-2 text-[15px] leading-snug text-white/70" aria-hidden>
        {label}
      </dd>
    </div>
  );
}
