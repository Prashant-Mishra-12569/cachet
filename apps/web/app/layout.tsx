import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cachet: the seal on every AI call',
  description: 'Know in one second if an AI caller is really your bank, or a scammer.',
};

export const viewport: Viewport = {
  themeColor: '#FAF8F5',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
