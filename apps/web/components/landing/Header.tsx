import Link from 'next/link';
import { CachetLogo } from '@/components/brand/Seal';
import { BOT_URL } from './links';

export function Header() {
  return (
    <header className="relative z-10 mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <Link href="/" className="flex min-h-11 items-center gap-2" aria-label="Cachet home">
        <CachetLogo className="h-9 w-auto sm:h-10" />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1 text-[15px]">
        <a
          href="#how"
          className="hidden min-h-11 items-center rounded-full px-3 text-ink-2 hover:text-ink md:flex"
        >
          How it works
        </a>
        <Link
          href="/business"
          className="hidden min-h-11 items-center rounded-full px-3 text-ink-2 hover:text-ink sm:flex"
        >
          For businesses
        </Link>
        <a
          href={BOT_URL}
          className="ml-1 flex min-h-11 items-center rounded-full bg-ink px-4 font-medium text-white transition-transform active:scale-[0.98]"
        >
          Open in Telegram
        </a>
      </nav>
    </header>
  );
}
