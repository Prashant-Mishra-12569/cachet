import type { Metadata } from 'next';
import { LocalTime } from '@/components/LocalTime';
import { Block, SitePage } from '@/components/site/SitePage';
import { getHealth, getPublicStats } from '@/lib/server-api';

export const metadata: Metadata = {
  title: 'Status · Cachet',
  description: 'Is Cachet working right now? Live checks of every part.',
};

// Checked again at most every 30 seconds.
export const revalidate = 30;

type State = 'ok' | 'down' | 'unknown';

const WORDS: Record<State, string> = { ok: 'Working', down: 'Not working', unknown: 'No answer' };
const TONE: Record<State, string> = {
  ok: 'bg-seal-soft text-seal',
  down: 'bg-alert-soft text-alert',
  unknown: 'border border-line text-ink-2',
};

function Row({ name, what, state }: { name: string; what: string; state: State }) {
  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div>
        <p className="font-semibold">{name}</p>
        <p className="mt-0.5 text-[15px] text-ink-2">{what}</p>
      </div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[13px] font-medium ${TONE[state]}`}>
        <span aria-hidden>{state === 'ok' ? '✓ ' : state === 'down' ? '! ' : ''}</span>
        {WORDS[state]}
      </span>
    </li>
  );
}

export default async function StatusPage() {
  const [health, stats] = await Promise.all([getHealth(), getPublicStats()]);
  const part = (k: string): State => (!health ? 'unknown' : health[k] === 'ok' ? 'ok' : 'down');
  const api: State = health?.ok ? 'ok' : 'unknown';
  const all = [api, part('database'), part('redis'), part('verifier')];
  const overall = all.every((s) => s === 'ok') ? 'ok' : all.some((s) => s === 'down') ? 'down' : 'unknown';

  return (
    <SitePage
      title="Status"
      intro={
        <p
          className={`inline-flex rounded-full px-4 py-2 text-[17px] font-medium ${TONE[overall]}`}
          role="status"
        >
          {overall === 'ok'
            ? 'All parts of Cachet are working.'
            : overall === 'down'
              ? 'Part of Cachet is not working right now.'
              : 'We could not reach the Cachet server.'}
        </p>
      }
    >
      <ul className="divide-y divide-line border-y border-line">
        <Row name="Seal service" what="Issues seals and sends call cards" state={api} />
        <Row name="Database" what="Companies, AI callers and call records" state={part('database')} />
        <Row name="Cache" what="Sign-ins, rate limits and live card updates" state={part('redis')} />
        <Row
          name="Company proof checker"
          what="Checks companies' private proofs from Concordium ID"
          state={part('verifier')}
        />
      </ul>

      <Block title="Permanent record">
        {stats?.lastRecord ? (
          <p>
            Latest record written on Concordium <LocalTime iso={stats.lastRecord.at} />, holding{' '}
            {stats.lastRecord.items} {stats.lastRecord.items === 1 ? 'item' : 'items'}.{' '}
            <a
              href={stats.lastRecord.txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink underline underline-offset-4"
            >
              See it on the explorer
            </a>
            . New calls join the record within about 5 minutes. {stats.sealsInPublicRecord} of{' '}
            {stats.sealsTotal} sealed calls are in it now.
          </p>
        ) : (
          <p>No record information right now.</p>
        )}
      </Block>

      <p className="text-sm text-ink-2">
        Network: Concordium {health?.network ?? 'testnet'}. This page checks again every 30 seconds.
      </p>
    </SitePage>
  );
}
