import Link from 'next/link';
import { Businesses } from '@/components/landing/Businesses';
import { Families } from '@/components/landing/Families';
import { Header } from '@/components/landing/Header';
import { HeroDemo } from '@/components/landing/HeroDemo';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { LiveRecord } from '@/components/landing/LiveRecord';
import { BOT_URL } from '@/components/landing/links';
import { Problem } from '@/components/landing/Problem';
import { Faq, FinalCta, Footer, Trust } from '@/components/landing/TrustAndFaq';
import { getPublicStats } from '@/lib/server-api';

// Live numbers refresh every 30 seconds; the rest of the page is static.
export const revalidate = 30;

export default async function HomePage() {
  const stats = await getPublicStats();
  return (
    <div className="relative isolate">
      <div aria-hidden className="hero-wash absolute inset-x-0 top-0 -z-10 h-[1100px] max-h-full" />
      <Header />
      <main id="top">
        <section
          aria-labelledby="hero-title"
          className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-8 pb-20 sm:px-6 sm:pt-14 lg:min-h-[calc(100svh-76px)] lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10 lg:py-6"
        >
          <div>
            <h1
              id="hero-title"
              className="text-[44px] leading-[1.02] font-semibold tracking-[-0.035em] sm:text-[64px] lg:text-[76px]"
            >
              Every AI call,
              <br />
              <em className="font-serif font-normal tracking-[-0.01em]">sealed.</em>
            </h1>
            <p className="mt-6 max-w-[34ch] text-[19px] leading-relaxed text-ink-2 sm:text-[21px]">
              Know in one second if an AI caller is really your bank, or a scammer.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={BOT_URL}
                className="inline-flex min-h-12 items-center rounded-full bg-seal px-6 text-[17px] font-medium text-white shadow-[0_8px_20px_-8px_rgb(15_107_79/0.6)] transition-transform active:scale-[0.98]"
              >
                Open in Telegram
              </a>
              <Link
                href="/business"
                className="inline-flex min-h-12 items-center rounded-full border border-ink/15 bg-surface/70 px-6 text-[17px] font-medium backdrop-blur transition-colors hover:bg-surface"
              >
                For businesses
              </Link>
            </div>
            <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-ink-2">
              Free for people. Works in Telegram. No crypto knowledge needed to check a call.
            </p>
          </div>
          <HeroDemo />
        </section>
        <Problem />
        <HowItWorks />
        <LiveRecord stats={stats} />
        <Families />
        <Businesses />
        <Trust />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
