import Link from 'next/link';
import { CachetLogo } from '@/components/brand/Seal';
import { MARK_PATH } from '@/components/brand/logo-paths';

/** A friendly 404: the seal, unstamped (an outline with no check). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <Link href="/" aria-label="Cachet home" className="inline-flex min-h-11 items-center">
        <CachetLogo className="h-8 w-auto" />
      </Link>
      <svg viewBox="0 0 220 220" className="size-28 rotate-[-8deg]" aria-hidden>
        <path
          d={MARK_PATH}
          fill="none"
          stroke="var(--color-ink-2)"
          strokeWidth="5"
          strokeDasharray="10 9"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">This page has no seal</h1>
        <p className="mt-2 text-lg text-ink-2">
          Nothing lives at this address. If a caller sent you this link, don&apos;t trust it: real seals only
          appear in your own Cachet chat on Telegram.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 font-medium text-white active:scale-[0.98]"
      >
        Go to the home page
      </Link>
    </main>
  );
}
