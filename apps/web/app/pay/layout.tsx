import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CachetLogo } from '@/components/brand/Seal';

export const metadata: Metadata = {
  title: 'Pay safely · Cachet',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** The browser half of a safe payment, opened from the Cachet bot on a phone. */
export default function PayLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between">
        <CachetLogo className="h-8 w-auto" />
        <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-2">Testnet</span>
      </header>
      {children}
    </main>
  );
}
