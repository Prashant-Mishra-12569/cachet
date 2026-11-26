'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { card, when } from './ui';

interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Read-only API keys for the company's own systems (GET /v1/data/*). */
export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ apiKeys: ApiKeyView[] }>('/v1/business/api-keys')
      .then((r) => setKeys(r.apiKeys))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load your API keys.'));
  }, []);
  useEffect(load, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ key: string; apiKey: ApiKeyView }>('/v1/business/api-keys', {
        name: name.trim(),
      });
      setFresh({ key: r.key, name: r.apiKey.name });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not make the key.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKeyView) => {
    if (!window.confirm(`Revoke "${k.name}"? Systems using it stop working at once.`)) return;
    try {
      await api.post(`/v1/business/api-keys/${k.id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke the key.');
    }
  };

  return (
    <section className={card} aria-labelledby="keys-title">
      <h2 id="keys-title" className="text-lg font-semibold">
        API keys (read-only)
      </h2>
      <p className="mt-1 max-w-[62ch] text-[15px] text-ink-2">
        Let your own systems pull your call numbers, calls, payments and the CSV. A key can only read: it
        can&apos;t seal calls or change anything, and it never sees phone numbers or call codes.{' '}
        <Link href="/developers#data-api" className="font-medium text-ink underline underline-offset-4">
          How to use it
        </Link>
      </p>

      {fresh ? (
        <div role="status" className="mt-4 rounded-[14px] border border-seal/30 bg-seal-soft p-4">
          <p className="font-medium text-seal">
            Your new key “{fresh.name}”. Copy it now: it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 basis-full rounded-[10px] bg-surface px-3 py-2 font-mono text-[13px] break-all sm:basis-0">
              {fresh.key}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(fresh.key).then(() => setCopied(true))}
              className="min-h-11 rounded-full bg-ink px-4 text-sm font-medium text-white"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFresh(null);
                setCopied(false);
              }}
              className="min-h-11 rounded-full border border-line px-4 text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={(e) => void create(e)} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[13px] text-ink-2">
          Name it after the system that uses it
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            placeholder="e.g. Billing dashboard"
            className="min-h-11 rounded-[12px] border border-line bg-surface px-3 text-[15px] text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-11 rounded-full bg-ink px-5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Making…' : 'Make a key'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert">
          {error}
        </p>
      ) : null}

      {keys && keys.length > 0 ? (
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {k.name} <span className="font-mono text-[13px] font-normal text-ink-2">{k.prefix}…</span>
                </p>
                <p className="text-[13px] text-ink-2">
                  Made {when(k.createdAt)} · {k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : 'never used'}
                  {k.revokedAt ? ` · revoked ${when(k.revokedAt)}` : ''}
                </p>
              </div>
              {k.revokedAt ? (
                <span className="rounded-full border border-line px-2.5 py-0.5 text-[13px] text-ink-2">
                  Revoked
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void revoke(k)}
                  className="min-h-11 rounded-full border border-line px-4 text-sm font-medium text-alert hover:bg-alert-soft"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
