import Link from 'next/link';
import type { ReactNode } from 'react';
import { CachetLogo } from '@/components/brand/Seal';
import { BOT_URL } from '@/components/landing/links';
import { Footer } from '@/components/landing/TrustAndFaq';

/** Frame for plain pages (privacy, terms, status): logo header, readable column, site footer. */
export function SitePage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Cachet home" className="inline-flex min-h-11 items-center">
            <CachetLogo className="h-8 w-auto" />
          </Link>
          <a
            href={BOT_URL}
            className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-[15px] font-medium text-white"
          >
            Open in Telegram
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[760px] flex-1 px-4 pt-12 pb-20 sm:px-6">
        <h1 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[44px]">
          {title}
        </h1>
        {intro ? <div className="mt-4 text-lg leading-relaxed text-ink-2">{intro}</div> : null}
        <div className="mt-10 flex flex-col gap-8">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[20px] font-semibold">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-[16px] leading-relaxed text-ink-2 [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}
