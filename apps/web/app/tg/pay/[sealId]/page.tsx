'use client';

import { use, useEffect, useState } from 'react';
import { ClosedNotice, PaidCard, PayFlow, PaySummary } from '@/components/pay/PayFlow';
import { ErrorCard, Skeleton, useTelegram, useTgData } from '@/components/tg/TelegramShell';
import { api, ApiError } from '@/lib/api';
import type { TgPaid, TgPrepared, TgSeal } from '@/lib/tg-types';

/**
 * Safe payment in the Telegram Mini App (plan §13.2).
 * Computer: pay right here (QR code for the phone wallet).
 * Phone: Telegram's web view can't open wallet apps, so the person continues in their phone's browser
 * with a one-time pass; this screen turns to "Paid" by itself.
 */
export default function TelegramPay({ params }: { params: Promise<{ sealId: string }> }) {
  const { sealId } = use(params);
  const { data: seal, error, reload } = useTgData<TgSeal>(`/seals/${encodeURIComponent(sealId)}`);
  const telegram = useTelegram();
  const [handedOff, setHandedOff] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // After handing off to the browser, keep checking so this screen shows "Paid" when it is.
  useEffect(() => {
    if (!handedOff || seal?.paid) return;
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [handedOff, seal?.paid, reload]);

  if (error) return <ErrorCard error={error} onRetry={() => void reload()} />;
  if (!seal || !telegram) return <Skeleton />;
  const pay = seal.pay;
  if (!pay) {
    return (
      <section className="tg-card">
        <h1 className="font-semibold">Nothing to pay</h1>
        <p className="mt-1 text-sm text-ink-2">This call didn&apos;t ask for a payment.</p>
      </section>
    );
  }

  const tg = telegram.tg;
  const auth = { authorization: `tma ${telegram.initData}` };
  const openUrl = (url: string) => tg.openLink(url);
  const haptic = (type: 'success' | 'error') => tg.HapticFeedback?.notificationOccurred(type);

  if (seal.paid) return <PaidCard pay={pay} paid={seal.paid} openUrl={openUrl} />;

  const phone = /android|ios/i.test(tg.platform);
  if (!phone) {
    return (
      <PayFlow
        pay={pay}
        phone={false}
        openUrl={openUrl}
        haptic={haptic}
        prepare={(sender) => api.post<TgPrepared>(`/v1/tg/pay/${sealId}/prepare`, { sender }, auth)}
        confirm={(txHash) =>
          api.post<TgPaid | { error: { code: string } }>(`/v1/tg/pay/${sealId}/confirm`, { txHash }, auth)
        }
      />
    );
  }

  async function continueInBrowser() {
    setProblem(null);
    try {
      const { pass } = await api.post<{ pass: string }>(`/v1/tg/pay/${sealId}/handoff`, {}, auth);
      // The pass goes in the #fragment: browsers never send it to any server.
      tg.openLink(`${window.location.origin}/pay/${sealId}#p=${pass}`, { try_browser: 'chrome' });
      setHandedOff(true);
    } catch (err) {
      haptic('error');
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <>
      <PaySummary pay={pay} />
      {problem && (
        <p role="alert" className="rounded-2xl bg-alert-soft px-4 py-3 text-sm text-alert">
          {problem}
        </p>
      )}
      {!pay.ready ? (
        <ClosedNotice />
      ) : handedOff ? (
        <section className="tg-card text-center text-sm">
          <p className="font-medium">Finish paying in your browser.</p>
          <p className="mt-1 text-ink-2">This screen updates by itself once it&apos;s paid.</p>
          <button
            type="button"
            onClick={() => void continueInBrowser()}
            className="mt-3 text-sm text-seal underline"
          >
            Open the payment page again
          </button>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => void continueInBrowser()}
          className="block rounded-full bg-seal px-5 py-3 text-center font-medium text-surface"
        >
          Continue in your browser to pay
        </button>
      )}
      <p className="px-1 text-center text-xs text-ink-2">
        Telegram can&apos;t open wallet apps, so you&apos;ll approve in your Concordium Wallet from your
        browser. The amount and company can&apos;t change on the way.
      </p>
    </>
  );
}
