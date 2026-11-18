import type { Metadata } from 'next';
import Link from 'next/link';
import { BusinessSignIn } from '@/components/BusinessSignIn';

export const metadata: Metadata = {
  title: 'For businesses · Cachet',
  description: 'Prove your AI caller is really you. Sign in with your Concordium Wallet.',
};

export default function BusinessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 px-4 py-16">
      <div className="text-center">
        <Link href="/" className="font-serif text-2xl italic">
          Cachet
        </Link>
        <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Prove it&apos;s really you calling.
        </h1>
      </div>
      <BusinessSignIn />
    </main>
  );
}
