import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TelegramShell } from '@/components/tg/TelegramShell';

export const metadata: Metadata = {
  title: 'Cachet',
  robots: { index: false, follow: false },
};

/** Telegram Mini App screens (plan §11.4). Opened from the Cachet bot only. */
export default function TelegramLayout({ children }: { children: ReactNode }) {
  return <TelegramShell>{children}</TelegramShell>;
}
