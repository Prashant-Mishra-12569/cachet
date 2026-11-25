'use client';

import { use, useEffect, useState } from 'react';
import { ClosedNotice, PaidCard, PayFlow } from '@/components/pay/PayFlow';
import { Skeleton } from '@/components/tg/TelegramShell';
import { api, ApiError } from '@/lib/api';
import { BOT_USERNAME } from '@/lib/telegram';
import type { TgPaid, TgPrepared, TgSeal } from '@/lib/tg-types';

type PayPageView = Pick<TgSeal, 'id' | 'status' | 'pay' | 'paid'>;

const STORE = (sealId: string) => `cachet:pay-pass:${sealId}`;

/** Read the one-time pass from the #fragment (then remove it from the address bar). */
function takePass(sealId: string): string | null {
  const m = /[#&]p=([A-Za-z0-9_-]{32})/.exec(window.location.hash);
  if (m?.[1]) {
    window.history.replaceState(null, '', window.location.pathname);
    try {
      sessionStorage.setItem(STORE(sealId), m[1]); // survives a reload of this tab only
    } catch {
      /* private mode: fine */
    }
    return m[1];
  }
  try {
    return sessionStorage.getItem(STORE(sealId));
  } catch {
    return null;
  }
}

/**
 * Safe payment in the phone's browser (plan §13.2), opened from the Cachet bot with a one-time pass.
 * Here a tap on "Open Concordium Wallet" can open the wallet app, which Telegram's web view can't.
 */
export default function BrowserPay({ params }: { params: Promise<{ sealId: string }> }) {
  const { sealId } = use(params);
  const [pass, setPass] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<PayPageView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPass(takePass(sealId));
  }, [sealId]);

  useEffect(() => {
    if (!pass) return;
    api
      .get<PayPageView>(`/v1/pay/${sealId}`, { authorization: `Pay ${pass}` })
      .then(setView)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'));
  }, [pass, sealId]);

  const backToTelegram = (
    <a
      href={`https://t.me/${BOT_USERNAME}`}
      className="mt-3 flex min-h-11 items-center text-sm font-medium text-seal underline"
    >
      Back to Telegram
    </a>
  );

  if (pass === null || error) {
    return (
      <section role="alert" className="tg-card">
        <h1 className="font-semibold">This payment link can&apos;t be used</h1>
        <p className="mt-1 text-sm text-ink-2">
          {error ?? 'Open it from the Cachet bot in Telegram: tap "Pay safely" on the call card.'}
        </p>
        {backToTelegram}
      </section>
    );
  }
  if (!pass || !view) return <Skeleton />;
  const pay = view.pay;
  if (!pay) {
    return (
      <section className="tg-card">
        <h1 className="font-semibold">Nothing to pay</h1>
        {backToTelegram}
      </section>
    );
  }
  if (view.paid) {
    return (
      <PaidCard pay={pay} paid={view.paid}>
        {backToTelegram}
      </PaidCard>
    );
  }
  if (!pay.ready) return <ClosedNotice />;

  const auth = { authorization: `Pay ${pass}` };
  return (
    <PayFlow
      pay={pay}
      phone={/android|iphone|ipad|mobile/i.test(navigator.userAgent)}
      prepare={(sender) => api.post<TgPrepared>(`/v1/pay/${sealId}/prepare`, { sender }, auth)}
      confirm={(txHash) =>
        api.post<TgPaid | { error: { code: string } }>(`/v1/pay/${sealId}/confirm`, { txHash }, auth)
      }
      afterPaid={backToTelegram}
    />
  );
}
