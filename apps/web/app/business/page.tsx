import type { Metadata } from 'next';
import Link from 'next/link';
import { BusinessSignIn } from '@/components/BusinessSignIn';
import { CachetLogo } from '@/components/brand/Seal';

export const metadata: Metadata = {
  title: 'For businesses · Cachet',
  description: 'Prove your AI caller is really you. Sign in with your Concordium Wallet.',
};

export default function BusinessPage() {
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
      <BusinessSignIn />
    </main>
  );
}
