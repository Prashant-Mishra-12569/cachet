'use client';

import { useCallback, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { NETWORK } from '@/lib/config';
import { requestProof, WalletError } from '@/lib/wallet';

export interface BusinessView {
  legalName: string;
  legalCountry: string;
  status: 'active' | 'suspended';
  verifiedAt: string;
  proofTxUrl: string;
  requestTxUrl: string;
}

type Step = 'unproven' | 'preparing' | 'approving' | 'verifying';

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const STEP_TEXT: Partial<Record<Step, string>> = {
  preparing: 'Preparing your proof request…',
  approving: 'Approve the proof in your wallet. Choose the account you signed in with.',
  verifying: 'Checking your proof on Concordium…',
};

export function CompanyProof({
  business,
  onProven,
}: {
  business: BusinessView | null;
  onProven: (b: BusinessView) => void;
}) {
  const [step, setStep] = useState<Step>('unproven');
  const [error, setError] = useState<string | null>(null);

  const prove = useCallback(async () => {
    setError(null);
    try {
      setStep('preparing');
      const { proofId, request } = await api.post<{ proofId: string; request: unknown }>(
        '/v1/business/proof/request',
      );
      setStep('approving');
      const presentation = await requestProof(NETWORK, request);
      setStep('verifying');
      const result = await api.post<{ business: BusinessView }>('/v1/business/proof/verify', {
        proofId,
        presentation,
      });
      setStep('unproven');
      onProven(result.business);
    } catch (err) {
      setError(
        err instanceof WalletError || err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.',
      );
      setStep('unproven');
    }
  }, [onProven]);

  if (business) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-seal-soft p-4">
        <p className="text-sm font-medium text-seal">
          <span aria-hidden="true">✓ </span>Verified company
        </p>
        <div>
          <p className="text-lg font-semibold text-ink">{business.legalName}</p>
          <p className="text-ink-2">{countryName(business.legalCountry)}</p>
        </div>
        <p className="text-sm text-ink-2">
          Proven with a private proof on Concordium. We only saw your company name and country.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a
            href={business.proofTxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-seal underline underline-offset-2"
          >
            Proof record ↗
          </a>
          <a
            href={business.requestTxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-2 underline underline-offset-2"
          >
            Request record ↗
          </a>
        </p>
      </div>
    );
  }

  const busy = step === 'preparing' || step === 'approving' || step === 'verifying';

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <div>
        <h3 className="font-semibold">Prove your company</h3>
        <p className="mt-1 text-sm text-ink-2">
          Your wallet shares only your company&apos;s legal name and country, using a private proof. Nothing
          else.
        </p>
      </div>
      <button
        type="button"
        onClick={prove}
        disabled={busy}
        className="min-h-11 rounded-full bg-seal px-5 font-medium text-surface transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Working…' : 'Prove my company'}
      </button>
      <div aria-live="polite" className="text-sm">
        {busy && <p className="text-ink-2">{STEP_TEXT[step]}</p>}
        {error && (
          <p className="rounded-xl bg-alert-soft px-4 py-3 text-alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
