'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { money, type TgPaid, type TgPrepared, type TgSeal } from '@/lib/tg-types';
import type { Pairing, WalletSession } from '@/lib/walletconnect';

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
export const plainEuro = (a: { value: string; asset: string }) => money(a).replace(' (test euro)', '');

type Pay = NonNullable<TgSeal['pay']>;

/** Amount, company, verified wallet and fee: what the person is about to pay. */
export function PaySummary({ pay, from }: { pay: Pay; from?: string | undefined }) {
  return (
    <>
      <section className="tg-card text-center">
        <p className="text-sm text-ink-2">You pay</p>
        <p className="mt-1 text-4xl font-semibold">{plainEuro(pay.amount)}</p>
        <p className="mt-1 text-sm text-ink-2">digital euro (test network)</p>
      </section>
      <section className="tg-card text-sm">
        <dl className="grid gap-3">
          <div>
            <dt className="text-ink-2">To</dt>
            <dd className="font-medium">{pay.company}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Their verified wallet</dt>
            <dd className="font-mono">{pay.recipient ? short(pay.recipient) : 'Not confirmed'}</dd>
            <dd className="mt-0.5 text-xs text-ink-2">
              Read live from the Concordium Agent Registry, never from the call.
            </dd>
          </div>
          <div>
            <dt className="text-ink-2">Fee</dt>
            <dd className="font-medium">Free (Cachet pays it)</dd>
          </div>
          {from && (
            <div>
              <dt className="text-ink-2">From your wallet</dt>
              <dd className="font-mono">{short(from)}</dd>
            </div>
          )}
        </dl>
      </section>
    </>
  );
}

export function PaidCard({
  pay,
  paid,
  openUrl,
  children,
}: {
  pay: Pay;
  paid: { txUrl: string };
  openUrl?: ((url: string) => void) | undefined;
  children?: ReactNode;
}) {
  return (
    <section className="tg-card border-seal/40 bg-seal-soft text-center">
      <p className="text-4xl" aria-hidden="true">
        ✅
      </p>
      <h1 className="mt-2 text-xl font-semibold">Paid {plainEuro(pay.amount)}</h1>
      <p className="mt-1 text-sm">to {pay.company}. No fee for you: Cachet covered it.</p>
      <a
        href={paid.txUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (!openUrl) return;
          e.preventDefault();
          openUrl(paid.txUrl);
        }}
        className="mt-4 inline-block rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium"
      >
        Receipt on Concordium ↗
      </a>
      {children}
    </section>
  );
}

export const ClosedNotice = () => (
  <p role="alert" className="rounded-2xl bg-alert-soft px-4 py-3 text-sm text-alert">
    ⚠️ Paying is closed: this call is no longer verified, or we couldn&apos;t confirm the company&apos;s
    wallet. Don&apos;t pay anyone who asks another way.
  </p>
);

type Step =
  | { name: 'starting' }
  | { name: 'pairing'; pairing: Pairing }
  | { name: 'connected'; wallet: WalletSession }
  | { name: 'approving'; wallet: WalletSession; requestId: number | null }
  | { name: 'confirming' }
  | { name: 'paid'; paid: TgPaid };

export interface PayFlowProps {
  pay: Pay;
  /** Phone: tappable "Open Concordium Wallet" links. Computer: a QR code. */
  phone: boolean;
  prepare(sender: string): Promise<TgPrepared>;
  /** Returns { status: 'paid' } once checked on chain; anything else means "not yet". */
  confirm(txHash: string): Promise<TgPaid | { error: { code: string } }>;
  openUrl?: ((url: string) => void) | undefined;
  haptic?: ((type: 'success' | 'error') => void) | undefined;
  /** Shown under the "Paid" card (e.g. "Back to Telegram"). */
  afterPaid?: ReactNode;
}

/**
 * Connect the Concordium Wallet (WalletConnect), let it approve the sponsored transfer Cachet built,
 * then wait until Cachet has checked the payment on chain.
 */
export function PayFlow({ pay, phone, prepare, confirm, openUrl, haptic, afterPaid }: PayFlowProps) {
  const [step, setStep] = useState<Step>({ name: 'starting' });
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  const fail = useCallback(
    (err: unknown) => {
      haptic?.('error');
      setProblem(err instanceof ApiError ? err.message : friendlyWalletError(err));
    },
    [haptic],
  );

  /** Start a WalletConnect pairing; becomes "connected" when the person approves in the wallet. */
  const pair = useCallback(async () => {
    setProblem(null);
    setStep({ name: 'starting' });
    try {
      const { startWalletPairing } = await import('@/lib/walletconnect');
      const pairing = await startWalletPairing();
      setStep({ name: 'pairing', pairing });
      const wallet = await pairing.approved;
      if (wallet) {
        haptic?.('success');
        setStep({ name: 'connected', wallet });
      } else {
        started.current = false;
        setStep({ name: 'starting' });
        setProblem('The wallet connection was not approved. Tap "Try again".');
      }
    } catch (err) {
      started.current = false;
      fail(err);
    }
  }, [fail, haptic]);

  // Get the pairing ready as soon as the screen opens, so connecting is a single tap.
  useEffect(() => {
    if (!pay.ready || started.current) return;
    started.current = true;
    void pair();
  }, [pay.ready, pair]);

  async function payNow(wallet: WalletSession) {
    setProblem(null);
    setStep({ name: 'approving', wallet, requestId: null });
    const stop = wallet.onRequestSent((requestId) => setStep({ name: 'approving', wallet, requestId }));
    try {
      const prepared = await prepare(wallet.account);
      const [{ AccountAddress }, { Transaction }] = await Promise.all([
        import('@concordium/web-sdk'),
        import('@concordium/web-sdk/transactions'),
      ]);
      const signable = Transaction.signableFromJSON(JSON.parse(prepared.transaction));
      // The wallet shows the exact transfer; the person approves it there.
      const txHash = await wallet.connection.signAndSendSponsoredTransaction(
        AccountAddress.fromBase58(wallet.account),
        signable,
      );
      setStep({ name: 'confirming' });
      for (let i = 0; i < 12; i++) {
        const res = await confirm(txHash);
        if ('status' in res && res.status === 'paid') {
          haptic?.('success');
          setStep({ name: 'paid', paid: res });
          return;
        }
        await new Promise((r) => setTimeout(r, 2500)); // not finalized yet
      }
      throw new ApiError(
        'pay_pending',
        'Your payment was sent but is taking long to confirm. Check again soon.',
        202,
      );
    } catch (err) {
      setStep({ name: 'connected', wallet });
      fail(err);
    } finally {
      stop();
    }
  }

  if (step.name === 'paid') {
    return (
      <PaidCard pay={pay} paid={step.paid} openUrl={openUrl}>
        {afterPaid}
      </PaidCard>
    );
  }

  const primary = 'block rounded-full bg-seal px-5 py-3 text-center font-medium text-surface';
  const from = step.name === 'connected' || step.name === 'approving' ? step.wallet.account : undefined;

  return (
    <>
      <PaySummary pay={pay} from={from} />
      {problem && (
        <p role="alert" className="rounded-2xl bg-alert-soft px-4 py-3 text-sm text-alert">
          {problem}
        </p>
      )}
      {!pay.ready ? (
        <ClosedNotice />
      ) : step.name === 'starting' ? (
        <button
          type="button"
          onClick={() => void pair()}
          disabled={!problem}
          className={`${primary} disabled:opacity-60`}
        >
          {problem ? 'Try again' : 'Getting your wallet link ready…'}
        </button>
      ) : step.name === 'pairing' ? (
        phone ? (
          <>
            {/* A real link the person taps: the only way a phone lets a page open another app. */}
            <a href={step.pairing.walletLink} className={primary}>
              Open Concordium Wallet
            </a>
            <p className="px-1 text-center text-xs text-ink-2">
              Approve the connection in the wallet. It brings you back here.
            </p>
          </>
        ) : (
          <button type="button" onClick={() => void step.pairing.showQr()} className={primary}>
            Show QR code for your Concordium Wallet
          </button>
        )
      ) : step.name === 'connected' ? (
        <button type="button" onClick={() => void payNow(step.wallet)} className={primary}>
          Pay {plainEuro(pay.amount)} safely
        </button>
      ) : step.name === 'approving' ? (
        phone && step.requestId !== null ? (
          <>
            <a href={step.wallet.requestLink(step.requestId)} className={primary}>
              Open Concordium Wallet to approve
            </a>
            <p className="px-1 text-center text-xs text-ink-2">
              Check the amount and company in the wallet, then approve.
            </p>
          </>
        ) : (
          <p className={`${primary} opacity-70`}>Approve it in your wallet…</p>
        )
      ) : (
        <p className={`${primary} opacity-70`}>Confirming on Concordium…</p>
      )}
      <p className="px-1 text-center text-xs text-ink-2">
        Your wallet shows the exact amount and company before you approve. Cachet never asks for your keys.
      </p>
    </>
  );
}

/** Wallet errors in plain words (the wallet library throws technical messages). */
function friendlyWalletError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel/i.test(text)) return 'You cancelled in your wallet. Nothing was paid.';
  if (/expired/i.test(text)) return 'The request expired. Please try again.';
  return "Your wallet couldn't complete this. Nothing was paid. Please try again.";
}
