'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AgentSetup } from './AgentSetup';
import { CompanyProof, type BusinessView } from './CompanyProof';

/** Everything a signed-in business does, in order: prove the company, then set up the AI caller. */
export function BusinessDashboard({ account }: { account: string }) {
  const [business, setBusiness] = useState<BusinessView | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ business: BusinessView | null }>('/v1/business/me')
      .then((r) => setBusiness(r.business))
      .catch(() => setBusiness(null));
  }, []);

  const onProven = useCallback((b: BusinessView) => setBusiness(b), []);

  if (business === undefined) return <p className="text-sm text-ink-2">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <CompanyProof business={business} onProven={onProven} />
      {business && <AgentSetup account={account} />}
    </div>
  );
}
