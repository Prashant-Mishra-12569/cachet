import type { Metadata } from 'next';
import { Block, SitePage } from '@/components/site/SitePage';
import { REPO_URL } from '@/components/landing/links';

export const metadata: Metadata = {
  title: 'Privacy · Cachet',
  description: 'What Cachet keeps, what it never keeps, and how to delete your data.',
};

export default function PrivacyPage() {
  return (
    <SitePage
      title="Privacy"
      intro={
        <p>
          Cachet exists to protect you, not to watch you. This page says exactly what we keep, in plain words.
          Cachet is a prototype running on the Concordium test network.
        </p>
      }
    >
      <Block title="We never">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Hear or record your calls.</strong> Cachet only knows that a verified company asked to
            call your number.
          </li>
          <li>
            <strong>Keep your phone number in plain text.</strong> It is stored only encrypted (AES-256-GCM),
            plus a secret fingerprint used to match calls.
          </li>
          <li>
            <strong>Show your number to companies.</strong> Companies see a person code that is different for
            every company, so they can&apos;t compare lists.
          </li>
          <li>
            <strong>Ask for codes, passwords, OTPs or seed phrases.</strong> If someone does, it isn&apos;t
            Cachet.
          </li>
        </ul>
      </Block>

      <Block title="If you use the Cachet bot">
        <p>We keep:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>your Telegram user and chat id, so we can send cards to your own chat;</li>
          <li>your phone number, encrypted, and its fingerprint (a keyed hash);</li>
          <li>your language;</li>
          <li>
            if you use them: family links (the name you gave, like &ldquo;Mom&rdquo;), which companies you
            allowed or blocked, and the calls you reported.
          </li>
        </ul>
        <p>
          <strong>Send /stop</strong> to delete your number, family links, allow/block choices and reports.
          Records of past sealed calls keep only the number fingerprint, which can&apos;t be turned back into
          your number without Cachet&apos;s secret key.
        </p>
      </Block>

      <Block title="If you are a company">
        <p>
          We keep your Concordium account address, the legal name and country your private proof revealed
          (nothing else from your identity), your AI caller&apos;s settings, and a record of every sealed
          call: time, calling number, reason, amount, outcome, and payments made inside a card.
        </p>
      </Block>

      <Block title="What goes on the blockchain">
        <p>
          The permanent public record on Concordium holds <strong>fingerprints</strong> (hashes) of seals and
          events, grouped into one fingerprint per batch. No phone numbers, names or messages are written on
          chain by Cachet. Company proofs, AI caller registrations and payments are ordinary Concordium
          transactions and are public, as on any blockchain.
        </p>
      </Block>

      <Block title="Short-lived data">
        <p>
          Sign-in sessions last 8 hours. To stop abuse we count requests per IP address for 10 minutes at a
          time; those counters then disappear. We don&apos;t use advertising or tracking cookies, and no
          analytics tools follow you around the site.
        </p>
      </Block>

      <Block title="Where it runs">
        <p>
          The website runs on Vercel; the Cachet server, its database and cache run on Railway. Telegram
          delivers the bot&apos;s messages under Telegram&apos;s own privacy policy.
        </p>
      </Block>

      <Block title="Questions">
        <p>
          Open an issue on{' '}
          <a href={REPO_URL} className="font-medium text-ink underline underline-offset-4">
            GitHub
          </a>
          . Cachet&apos;s source code is public, so anyone can check that this page matches what the code
          does.
        </p>
      </Block>
    </SitePage>
  );
}
