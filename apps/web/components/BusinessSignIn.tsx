'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { NETWORK } from '@/lib/config';
import { connectWallet, signWithWallet, WALLET_SETUP_URL, WalletError } from '@/lib/wallet';
import { BusinessDashboard } from './BusinessDashboard';
import { CachetLogo } from './brand/Seal';

type Me = { account: string; expiresAt: string };
type Step = 'checking' | 'signed-out' | 'connecting' | 'approving' | 'verifying' | 'signed-in';

const STEP_TEXT: Partial<Record<Step, string>> = {
  connecting: 'Connecting to your wallet…',
  approving: 'Approve the sign-in message in your wallet.',
  verifying: 'Checking your approval…',
};

export function BusinessSignIn() {
  const [step, setStep] = useState<Step>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<{ message: string; showSetup: boolean } | null>(null);

  // Already signed in? (the session cookie is sent automatically)
  useEffect(() => {
    api
      .get<({ signedIn: true } & Me) | { signedIn: false }>('/v1/auth/session')
      .then((s) => {
        if (s.signedIn) {
          setMe({ account: s.account, expiresAt: s.expiresAt });
          setStep('signed-in');
        } else {
          setStep('signed-out');
        }
      })
      .catch(() => setStep('signed-out'));
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      setStep('connecting');
      const { wallet, account } = await connectWallet(NETWORK);
      const challenge = await api.post<{ challengeId: string; message: string }>('/v1/auth/challenge', {
        account,
      });

      setStep('approving');
      const signature = await signWithWallet(wallet, account, challenge.message);

      setStep('verifying');
      const result = await api.post<Me>('/v1/auth/verify', {
        challengeId: challenge.challengeId,
        account,
        signature,
      });
      setMe(result);
      setStep('signed-in');
    } catch (err) {
      const message =
        err instanceof WalletError || err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.';
      setError({ message, showSetup: err instanceof WalletError && err.code === 'not_installed' });
      setStep('signed-out');
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/v1/auth/logout').catch(() => undefined);
    setMe(null);
    setStep('signed-out');
  }, []);

  const busy = step === 'connecting' || step === 'approving' || step === 'verifying';

  if (step === 'signed-in' && me) return <BusinessDashboard account={me.account} onSignOut={signOut} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 px-4 py-16">
      <div className="text-center">
        <Link href="/" aria-label="Cachet home" className="inline-flex min-h-11 items-center">
          <CachetLogo className="h-9 w-auto" />
        </Link>
        <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Prove it&apos;s really you calling.
        </h1>
      </div>
      <section className="w-full max-w-lg rounded-[20px] border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/.04),0_8px_24px_rgb(0_0_0/.06)] sm:p-8">
        {step === 'checking' ? (
          <p className="text-sm text-ink-2" aria-live="polite">
            Checking your sign-in…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold">Sign in for businesses</h2>
              <p className="mt-1 text-ink-2">
                Use your Concordium Wallet with your company account. You&apos;ll approve a sign-in message.
                No payment, no fee.
              </p>
            </div>

            <button
              type="button"
              onClick={signIn}
              disabled={busy}
              className="min-h-12 rounded-full bg-ink px-6 font-medium text-surface transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Waiting for your wallet…' : 'Sign in with Concordium'}
            </button>

            <div aria-live="polite" className="min-h-6 text-sm">
              {busy && <p className="text-ink-2">{STEP_TEXT[step]}</p>}
              {error && (
                <div className="rounded-xl bg-alert-soft px-4 py-3 text-alert" role="alert">
                  <p>{error.message}</p>
                  {error.showSetup && (
                    <a
                      href={WALLET_SETUP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block font-medium underline underline-offset-2"
                    >
                      How to get the Concordium Wallet ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
