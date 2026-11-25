import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
// Mono is only for call codes and code samples, never the first thing painted: don't preload it.
const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
});
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  // Only the italic is used (the headline accent and quotes): one file instead of two.
  style: 'italic',
  variable: '--font-instrument',
  display: 'swap',
});

const SITE = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://getcachet.site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Cachet: the seal on every AI call',
  description: 'Know in one second if an AI caller is really your bank, or a scammer.',
  openGraph: {
    title: 'Cachet: the seal on every AI call',
    description: 'Know in one second if an AI caller is really your bank, or a scammer.',
    url: SITE,
    siteName: 'Cachet',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#FAF8F5',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
