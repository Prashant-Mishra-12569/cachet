import Link from 'next/link';
import { CachetLogo } from '@/components/brand/Seal';

export default function SealNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <CachetLogo className="h-9 w-auto" />
      <h1 className="text-2xl font-semibold">No seal with this link</h1>
      <p className="text-ink-2">
        This link doesn&apos;t match any Cachet seal. If someone sent it to you during a call, treat the call
        as a scam: don&apos;t pay and don&apos;t share codes.
      </p>
      <Link href="/" className="mt-2 rounded-full border border-line px-5 py-3 font-medium">
        Go to Cachet
      </Link>
    </main>
  );
}
