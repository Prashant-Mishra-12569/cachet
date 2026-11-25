import type { Metadata } from 'next';
import { BusinessSignIn } from '@/components/BusinessSignIn';

export const metadata: Metadata = {
  title: 'For businesses · Cachet',
  description: 'Prove your AI caller is really you. Sign in with your Concordium Wallet.',
};

/** Sign in, then the company dashboard (both rendered by BusinessSignIn). */
export default function BusinessPage() {
  return <BusinessSignIn />;
}
