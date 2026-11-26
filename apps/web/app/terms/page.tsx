import type { Metadata } from 'next';
import { Block, SitePage } from '@/components/site/SitePage';

export const metadata: Metadata = {
  title: 'Terms · Cachet',
  description: 'The plain terms for using the Cachet prototype.',
};

export default function TermsPage() {
  return (
    <SitePage title="Terms" intro={<p>Short and plain, because Cachet is a prototype.</p>}>
      <Block title="A prototype on a test network">
        <p>
          Cachet runs on the Concordium <strong>test network</strong>. Its digital euros are test tokens with
          no value, and the companies shown in demos are demo companies. Don&apos;t send real money or rely on
          Cachet as your only protection against scams yet.
        </p>
      </Block>

      <Block title="What a seal means">
        <p>
          A seal means a company proved its identity on Concordium, registered its AI caller, and asked Cachet
          to tell you it is calling. It doesn&apos;t mean Cachet checked what the company says on the call. If
          anything feels wrong, hang up and contact the company through its official website or app.
        </p>
      </Block>

      <Block title="For companies">
        <p>
          You may only seal calls you are really making, from numbers and for purposes you registered.
          Don&apos;t call people who blocked you. The compliance report shows what happened on your calls; it
          is not legal advice.
        </p>
      </Block>

      <Block title="No guarantees">
        <p>
          Cachet is provided as it is, without warranties. It may be unavailable, change, or lose test data
          while it is being built.
        </p>
      </Block>
    </SitePage>
  );
}
