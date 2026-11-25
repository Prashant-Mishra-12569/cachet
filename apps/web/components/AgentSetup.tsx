'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { NETWORK } from '@/lib/config';
import { sendContractUpdate, WalletError, type WalletTx } from '@/lib/wallet';

interface AgentView {
  id: string;
  name: string;
  description: string;
  purposes: string[];
  language: string;
  callingNumbers: string[];
  agentAccount: string;
  status: 'draft' | 'registered' | 'active' | 'revoked';
  tokenId: string | null;
  badge: string | null;
  badgeCheckUrl: string | null;
  agentWallet: string | null;
  agentUri: string | null;
  registerTxUrl: string | null;
  cardTxUrl: string | null;
  pendingCallingNumbers: string[] | null;
}

const PURPOSES: { id: string; label: string }[] = [
  { id: 'billing', label: 'Billing' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'support', label: 'Support' },
  { id: 'account_alerts', label: 'Account alerts' },
];

const LANGUAGES: { id: string; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'nl', label: 'Dutch' },
  { id: 'de', label: 'German' },
  { id: 'fr', label: 'French' },
  { id: 'es', label: 'Spanish' },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-5)}`;
const message = (err: unknown) =>
  err instanceof WalletError || err instanceof ApiError
    ? err.message
    : 'Something went wrong. Please try again.';

/** A signed transaction we still have to confirm (kept across reloads so nobody signs twice). */
const pendingKey = (agentId: string, step: 'register' | 'card' | 'numbers') =>
  `cachet:pending:${agentId}:${step}`;
const readPending = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePending = (key: string, txHash: string | null) => {
  try {
    if (txHash) window.localStorage.setItem(key, txHash);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode: fine, just no resume */
  }
};

export function AgentSetup({ account }: { account: string }) {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ agents: AgentView[] }>('/v1/agents')
      .then((r) => setAgents(r.agents))
      .catch((err: unknown) => setLoadError(message(err)));
  }, []);
  useEffect(load, [load]);

  const replace = (a: AgentView) => setAgents((list) => (list ?? []).map((x) => (x.id === a.id ? a : x)));

  if (loadError) return <p className="text-sm text-alert">{loadError}</p>;
  if (!agents) return <p className="text-sm text-ink-2">Loading your AI callers…</p>;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold">Your AI caller</h3>
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} account={account} onChange={replace} />
      ))}
      {agents.length === 0 && <NewAgentForm defaultAccount="" onCreated={(a) => setAgents([a])} />}
    </div>
  );
}

function NewAgentForm({
  onCreated,
  defaultAccount,
}: {
  onCreated: (a: AgentView) => void;
  defaultAccount: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purposes, setPurposes] = useState<string[]>(['billing']);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const numbers = String(form.get('numbers') ?? '')
      .split(/[\s,;]+/)
      .map((n) => n.replace(/[^\d+]/g, ''))
      .filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      const { agent } = await api.post<{ agent: AgentView }>('/v1/agents', {
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? ''),
        purposes,
        language: String(form.get('language') ?? 'en'),
        callingNumbers: numbers,
        agentAccount: String(form.get('agentAccount') ?? '').trim(),
      });
      onCreated(agent);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'invalid_request'
          ? 'Please check the fields. Phone numbers need the country code, like +31 20 123 4567.'
          : message(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base outline-none focus-visible:border-seal focus-visible:ring-2 focus-visible:ring-seal-soft';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line p-4">
      <div>
        <h4 className="font-semibold">Add your AI caller</h4>
        <p className="mt-1 text-sm text-ink-2">People will see this on every verified call.</p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" required maxLength={80} placeholder="Billing assistant" className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        What it does
        <textarea
          name="description"
          required
          maxLength={500}
          rows={2}
          placeholder="Calls customers about their electricity bills."
          className={input}
        />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">Why it calls</legend>
        <div className="flex flex-wrap gap-2">
          {PURPOSES.map((p) => {
            const on = purposes.includes(p.id);
            return (
              <button
                type="button"
                key={p.id}
                aria-pressed={on}
                onClick={() => setPurposes((list) => (on ? list.filter((x) => x !== p.id) : [...list, p.id]))}
                className={`min-h-11 rounded-full border px-4 transition ${on ? 'border-seal bg-seal-soft text-seal' : 'border-line text-ink-2'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        Phone numbers it calls from
        <input name="numbers" required placeholder="+31 20 123 4567" className={input} />
        <span className="text-ink-2">With country code. Separate several numbers with commas.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Language
        <select name="language" defaultValue="en" className={input}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        The AI&apos;s own Concordium account
        <input
          name="agentAccount"
          required
          defaultValue={defaultAccount}
          placeholder="33Rcud…"
          className={`${input} font-mono text-sm`}
        />
        <span className="text-ink-2">This account pays the small fee for each sealed call.</span>
      </label>
      <button
        type="submit"
        disabled={busy || purposes.length === 0}
        className="min-h-11 rounded-full bg-ink px-5 font-medium text-surface transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Save AI caller'}
      </button>
      {error && (
        <p className="rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

type Busy = null | 'preparing' | 'wallet' | 'confirming' | 'publishing';
const BUSY_TEXT: Record<Exclude<Busy, null>, string> = {
  preparing: 'Preparing the transaction…',
  publishing: 'Publishing your Agent Card (this can take up to a minute)…',
  wallet: 'Approve the transaction in your wallet.',
  confirming: 'Waiting for Concordium to confirm (about 10 seconds)…',
};

/**
 * The numbers your AI caller really calls from. Cachet only seals calls from these numbers, and people
 * see them on /company. Changing them publishes a new Agent Card that you pin on Concordium; the old
 * numbers stay in force until then.
 */
function NumbersEditor({
  agent,
  account,
  onChange,
}: {
  agent: AgentView;
  account: string;
  onChange: (a: AgentView) => void;
}) {
  const key = pendingKey(agent.id, 'numbers');
  const [text, setText] = useState(agent.callingNumbers.join(', '));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(readPending(key)), [key]);

  const confirm = async (txHash: string) => {
    setBusy('confirming');
    const { agent: next } = await api.post<{ agent: AgentView }>(`/v1/agents/${agent.id}/numbers/confirm`, {
      txHash,
    });
    writePending(key, null);
    setPending(null);
    onChange(next);
    setText(next.callingNumbers.join(', '));
  };

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const numbers = [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
    if (numbers.length === 0 || numbers.some((n) => !/^\+[1-9]\d{6,14}$/.test(n))) {
      setError('Use international format, separated by commas, like +918035735856.');
      return;
    }
    try {
      setBusy('publishing');
      const prepared = await api.post<{ walletTx: WalletTx }>(`/v1/agents/${agent.id}/numbers/prepare`, {
        callingNumbers: numbers,
      });
      setBusy('wallet');
      const txHash = await sendContractUpdate(NETWORK, account, prepared.walletTx);
      writePending(key, txHash);
      setPending(txHash);
      await confirm(txHash);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    if (!pending) return;
    setError(null);
    try {
      await confirm(pending);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
      <label htmlFor={`numbers-${agent.id}`} className="font-medium">
        Calls come from
      </label>
      <input
        id={`numbers-${agent.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-11 rounded-xl border border-line bg-surface px-3 font-mono"
        autoComplete="off"
      />
      <p className="text-ink-2">
        Cachet only seals calls from these numbers. Changing them asks your wallet to update your Agent Card
        on Concordium.
      </p>
      {pending ? (
        <button
          type="button"
          onClick={retry}
          disabled={busy !== null}
          className="min-h-11 rounded-full border border-seal px-5 font-medium text-seal disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Check again'}
        </button>
      ) : (
        <button
          type="submit"
          disabled={busy !== null || text.trim() === agent.callingNumbers.join(', ')}
          className="min-h-11 rounded-full bg-seal px-5 font-medium text-surface disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Update calling numbers'}
        </button>
      )}
      <div aria-live="polite">
        {busy && <p className="text-ink-2">{BUSY_TEXT[busy]}</p>}
        {error && (
          <p className="rounded-xl bg-alert-soft px-4 py-3 text-alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function AgentCard({
  agent,
  account,
  onChange,
}: {
  agent: AgentView;
  account: string;
  onChange: (a: AgentView) => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [badge, setBadge] = useState<{ badge_valid: boolean } | null>(null);
  const step = agent.status === 'draft' ? 'register' : agent.status === 'registered' ? 'card' : null;
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setPending(step ? readPending(pendingKey(agent.id, step)) : null);
  }, [agent.id, step]);

  useEffect(() => {
    if (agent.status !== 'active') return;
    api
      .get<{ badge: { badge_valid: boolean } }>(`/v1/agents/${agent.id}/badge`)
      .then((r) => setBadge(r.badge))
      .catch(() => setBadge(null));
  }, [agent.id, agent.status]);

  const confirm = useCallback(
    async (which: 'register' | 'card', txHash: string) => {
      setBusy('confirming');
      const { agent: next } = await api.post<{ agent: AgentView }>(
        `/v1/agents/${agent.id}/${which}/confirm`,
        {
          txHash,
        },
      );
      writePending(pendingKey(agent.id, which), null);
      setPending(null);
      onChange(next);
    },
    [agent.id, onChange],
  );

  const run = useCallback(
    async (which: 'register' | 'card') => {
      setError(null);
      try {
        setBusy(which === 'card' ? 'publishing' : 'preparing');
        const prepared = await api.post<{ walletTx: WalletTx }>(`/v1/agents/${agent.id}/${which}/prepare`);
        setBusy('wallet');
        const txHash = await sendContractUpdate(NETWORK, account, prepared.walletTx);
        writePending(pendingKey(agent.id, which), txHash);
        setPending(txHash);
        await confirm(which, txHash);
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(null);
      }
    },
    [account, agent.id, confirm],
  );

  const retry = useCallback(async () => {
    if (!step || !pending) return;
    setError(null);
    try {
      await confirm(step, pending);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }, [confirm, pending, step]);

  const done = (ok: boolean) => (ok ? 'bg-seal text-surface' : 'border border-line text-ink-2');

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line p-4">
      <div>
        <p className="font-semibold">{agent.name}</p>
        <p className="text-sm text-ink-2">{agent.description}</p>
        <p className="mt-1 font-mono text-xs text-ink-2">{agent.callingNumbers.join(' · ')}</p>
      </div>

      <ol className="flex flex-col gap-2 text-sm">
        <li className="flex items-center gap-2">
          <span
            className={`grid size-6 place-items-center rounded-full text-xs ${done(agent.status !== 'draft')}`}
          >
            1
          </span>
          Registered on Concordium
          {agent.registerTxUrl && (
            <a
              href={agent.registerTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-seal underline"
            >
              record ↗
            </a>
          )}
        </li>
        <li className="flex items-center gap-2">
          <span
            className={`grid size-6 place-items-center rounded-full text-xs ${done(agent.status === 'active')}`}
          >
            2
          </span>
          Agent Card published and pinned
          {agent.cardTxUrl && (
            <a
              href={agent.cardTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-seal underline"
            >
              record ↗
            </a>
          )}
        </li>
      </ol>

      {agent.agentWallet && (
        <p className="text-sm text-ink-2">
          Payments can only go to your verified company account{' '}
          <span className="font-mono text-ink">{short(agent.agentWallet)}</span>.
        </p>
      )}

      {agent.status === 'active' && (
        <div className="flex flex-col gap-1 rounded-xl bg-seal-soft p-3 text-sm">
          <p className="font-medium text-seal">
            <span aria-hidden="true">✓ </span>
            {badge === null
              ? 'Verified by Concordium'
              : badge.badge_valid
                ? 'Verified by Concordium'
                : 'Badge check pending'}
          </p>
          <p className="flex flex-wrap gap-x-4 text-ink-2">
            {agent.agentUri && (
              <a href={agent.agentUri} target="_blank" rel="noopener noreferrer" className="underline">
                Agent Card ↗
              </a>
            )}
            {agent.badgeCheckUrl && (
              <a href={agent.badgeCheckUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Badge check ↗
              </a>
            )}
          </p>
        </div>
      )}

      {agent.status === 'active' && <NumbersEditor agent={agent} account={account} onChange={onChange} />}

      {step && (
        <div className="flex flex-col gap-2">
          {pending ? (
            <button
              type="button"
              onClick={retry}
              disabled={busy !== null}
              className="min-h-11 rounded-full border border-seal px-5 font-medium text-seal disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Check again'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => run(step)}
              disabled={busy !== null}
              className="min-h-11 rounded-full bg-seal px-5 font-medium text-surface transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? 'Working…' : step === 'register' ? 'Register on Concordium' : 'Publish Agent Card'}
            </button>
          )}
          <div aria-live="polite" className="text-sm">
            {busy && <p className="text-ink-2">{BUSY_TEXT[busy]}</p>}
            {pending && !busy && !error && (
              <p className="text-ink-2">
                Your transaction was sent. Press “Check again” if this page doesn&apos;t update.
              </p>
            )}
            {error && (
              <p className="rounded-xl bg-alert-soft px-4 py-3 text-alert" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
