'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { BOT_USERNAME, loadTelegram, type TelegramWebApp } from '@/lib/telegram';
import { CachetLogo } from '@/components/brand/Seal';

type Shell =
  { state: 'loading' } | { state: 'outside' } | { state: 'ready'; tg: TelegramWebApp; initData: string };

const TelegramContext = createContext<{ tg: TelegramWebApp; initData: string } | null>(null);

/**
 * Wraps every /tg screen: loads Telegram, follows its light/dark theme, shows Telegram's own Back
 * button on inner screens, and refuses to show anything outside Telegram.
 */
export function TelegramShell({ children }: { children: ReactNode }) {
  const [shell, setShell] = useState<Shell>({ state: 'loading' });
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    void loadTelegram().then((tg) => {
      if (cancelled) return;
      if (!tg || !tg.initData) {
        setShell({ state: 'outside' });
        return;
      }
      tg.ready();
      tg.expand();
      setScheme(tg.colorScheme);
      setShell({ state: 'ready', tg, initData: tg.initData });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow Telegram's theme when the person switches light/dark while the app is open.
  useEffect(() => {
    if (shell.state !== 'ready') return;
    const tg = shell.tg;
    const onTheme = () => setScheme(tg.colorScheme);
    tg.onEvent('themeChanged', onTheme);
    return () => tg.offEvent('themeChanged', onTheme);
  }, [shell]);

  // Telegram's Back button on every screen except the home screen.
  useEffect(() => {
    if (shell.state !== 'ready') return;
    const back = shell.tg.BackButton;
    if (pathname === '/tg') {
      back.hide();
      return;
    }
    const onBack = () => (window.history.length > 1 ? router.back() : router.push('/tg'));
    back.onClick(onBack);
    back.show();
    return () => back.offClick(onBack);
  }, [shell, pathname, router]);

  return (
    <div className="tg-app min-h-dvh bg-bg text-ink" data-scheme={scheme}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-4 pb-10">
        {shell.state === 'loading' && <Skeleton />}
        {shell.state === 'outside' && <Outside />}
        {shell.state === 'ready' && (
          <TelegramContext.Provider value={{ tg: shell.tg, initData: shell.initData }}>
            {children}
          </TelegramContext.Provider>
        )}
      </div>
    </div>
  );
}

function Outside() {
  return (
    <section className="tg-card mt-10 text-center">
      <CachetLogo className="mx-auto h-10 w-auto" />
      <h1 className="mt-4 text-lg font-semibold">Open this inside Telegram</h1>
      <p className="mt-2 text-sm text-ink-2">
        These screens only work from the Cachet bot, so we know they are really yours.
      </p>
      <a
        href={`https://t.me/${BOT_USERNAME}`}
        className="mt-5 inline-block rounded-full bg-seal px-5 py-2.5 text-sm font-medium text-surface"
      >
        Open @{BOT_USERNAME}
      </a>
    </section>
  );
}

export function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="tg-card h-28 animate-pulse" />
      <div className="tg-card h-48 animate-pulse" />
    </div>
  );
}

/** Telegram + its signed launch data (for POSTs to the Mini App API). Null outside the shell. */
export function useTelegram() {
  return useContext(TelegramContext);
}

/** GET from the Mini App API, signed with Telegram's launch data. */
export function useTgData<T>(path: string) {
  const ctx = useContext(TelegramContext);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setError(null);
    try {
      setData(await api.get<T>(`/v1/tg${path}`, { authorization: `tma ${ctx.initData}` }));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('unknown', 'Something went wrong.', 0));
    }
  }, [ctx, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load, tg: ctx?.tg ?? null };
}

export function ErrorCard({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const notRegistered = error.code === 'tg_not_registered';
  return (
    <section role="alert" className="tg-card">
      <h1 className="font-semibold">{notRegistered ? 'Share your number first' : 'Something went wrong'}</h1>
      <p className="mt-1 text-sm text-ink-2">{error.message}</p>
      {onRetry && !notRegistered && error.code !== 'tg_session_expired' && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-full border border-line px-4 py-2 text-sm font-medium"
        >
          Try again
        </button>
      )}
    </section>
  );
}
