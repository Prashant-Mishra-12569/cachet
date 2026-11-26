import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { explorerTxUrl } from '@cachet/shared';
import { CachetLogo } from '@/components/brand/Seal';

export const metadata: Metadata = {
  title: 'Developers · Cachet',
  description:
    'Seal every AI call: one signed request before you dial, pay per call with x402, close it when the call ends.',
};

const API = 'https://api.getcachet.site';
const tx = (h: string) => explorerTxUrl('testnet', h);

const TOC = [
  ['quickstart', 'Quickstart'],
  ['request', 'Ask for a seal'],
  ['pay', 'Pay per call (x402)'],
  ['close', 'Close the seal'],
  ['checks', 'What Cachet checks'],
  ['verify', 'Verify a seal yourself'],
  ['mcp', 'Use it from an AI agent (MCP)'],
  ['errors', 'Errors'],
  ['threats', 'Threat model'],
  ['concordium', 'Built on Concordium'],
] as const;

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="my-4 min-w-0">
      {label ? <figcaption className="mb-1.5 text-[13px] text-ink-2">{label}</figcaption> : null}
      <pre className="overflow-x-auto rounded-[16px] bg-night p-4 text-[13px] leading-[1.65] text-white/90 sm:p-5">
        <code className="font-mono">{children.trim()}</code>
      </pre>
    </figure>
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-14 scroll-mt-6 text-[26px] leading-tight font-semibold tracking-[-0.02em] first:mt-0"
    >
      {children}
    </h2>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 max-w-[68ch] text-[16px] leading-relaxed text-ink-2">{children}</p>
);
const C = ({ children }: { children: ReactNode }) => (
  <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.88em] text-ink">{children}</code>
);

const ERRORS: [number, string, string][] = [
  [400, 'number_not_allowed', '`from` is not one of the numbers registered for this AI caller.'],
  [400, 'purpose_not_allowed', '`purpose` is not one of the registered purposes.'],
  [400, 'message_not_allowed', 'Message too long (80 max), or contains a link or a long number.'],
  [400, 'seal_stale', '`ts` is more than 120 seconds away from the server clock.'],
  [401, 'seal_bad_signature', 'The signature does not match the request and the AI’s account keys.'],
  [
    402,
    'payment_required',
    'No credits left: pay this seal with x402 (see PAYMENT-REQUIRED), or buy credits.',
  ],
  [403, 'agent_revoked', 'The AI caller is switched off in the Concordium Agent Registry.'],
  [403, 'consent_revoked', 'This person blocked your company in Cachet. Don’t call them.'],
  [404, 'agent_unknown', 'The badge is not a registered, active Cachet AI caller.'],
  [409, 'seal_replay', 'This exact signed request (nonce) was already used.'],
  [
    409,
    'seal_not_open',
    'Close: the seal already ended (closed, replaced or expired). Safe to treat as done.',
  ],
];

const THREATS: [string, string, 'built' | 'planned'][] = [
  [
    'Caller ID spoofing',
    'A number proves nothing. Only a card delivered to the person’s own Telegram counts.',
    'built',
  ],
  ['Cloned voice of a real company', 'No seal means no card, and /check answers “Not verified”.', 'built'],
  [
    'Scammer reads out a made-up code',
    'People trust only the code in their own card; /check shows the open seal’s company and code.',
    'built',
  ],
  [
    'Replaying an old seal request',
    'Single-use nonce, ±120 s clock window, and the request is signed by the AI’s own account key.',
    'built',
  ],
  [
    'Reusing an old seal',
    'Seals expire after 15 minutes, are bound to one person’s number fingerprint, and only one can be open per AI caller and person.',
    'built',
  ],
  [
    'Scam call while a real seal is still open',
    'The AI closes the seal when the call ends (with retries); /check shows which company and code is open.',
    'built',
  ],
  [
    'A company’s AI key is stolen',
    'The company switches its AI caller off in the Concordium registry, or Cachet revokes its Web3 ID credential; both are checked on every seal, so seals stop at once.',
    'built',
  ],
  [
    'Paying a scammer instead of the company',
    'The Pay button can only send to the AI caller’s wallet registered on chain; the amount and memo are checked after finality.',
    'built',
  ],
  [
    'Probing someone else’s number',
    '/check works only for the number you shared from your own Telegram account.',
    'built',
  ],
  ['Flooding the seal API', 'Every seal costs €0.01 (x402), plus per-IP rate limits.', 'built'],
  [
    'Fake Cachet bot',
    'The bot never asks for codes, passwords or seed phrases; the website names the one official bot.',
    'built',
  ],
  [
    'A verified company turns rogue',
    'People can report and block; records can’t be deleted. Automatic suspension from report patterns is planned.',
    'planned',
  ],
  [
    'Telegram account takeover or SIM swap',
    'Out of scope for this version; an optional identity check before large payments is planned.',
    'planned',
  ],
];

const ONCHAIN: [string, string, string][] = [
  [
    'Concordium ID, Verify & Access',
    'The company proves its legal name and country with a private proof. Only those two facts are revealed.',
    'f2b1b2403cc2920d80303184e45448a56dd380d34465899b58a61a5168e6a9af',
  ],
  [
    'Agent Registry (CIS-8004) + Verified badge',
    'The AI caller is registered with its numbers, purposes and payment wallet; its public card is pinned by hash.',
    '3a4b75328b8cb1fa89a19bb3128966b48c16d40f006c85f7297f2c642c34b70b',
  ],
  [
    'x402 payments',
    'The AI pays for its own seals: €0.01 each, settled on chain before the seal is issued.',
    '41ebd94d2709937b19fe455525e05a057a7a06a63350f75337d2f56a57489b34',
  ],
  [
    'Protocol-level token + sponsored transaction',
    'A person pays a bill in digital euros from a wallet with 0 CCD; Cachet pays the network fee.',
    'cf0364f41ef0d7ceedbec164bf55439f0f46e8c4e0c800d73f0f5a241099eb87',
  ],
  [
    'Web3 ID credential registry (CIS-4)',
    'Each live AI caller holds an "Authorised AI Caller" credential in Cachet’s registry. Cachet can revoke it, and seals stop at once.',
    '975f8d0b77cd269ba9dc217e07ed16173edebd421649d11d1c5797a932401ea9',
  ],
  [
    'Permanent record (RegisterData)',
    'Batches of seals are written on chain as one fingerprint (a Merkle root).',
    'ff0787b6e35f41798bed8aeb6bc997787cc18d521760ed3f3c74661b6084a8ca',
  ],
];

export default function DevelopersPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Cachet home" className="inline-flex min-h-11 items-center">
            <CachetLogo className="h-8 w-auto" />
          </Link>
          <Link
            href="/business"
            className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-[15px] font-medium text-white"
          >
            Verify your company
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 pt-10 pb-24 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
          <p className="text-sm font-semibold">On this page</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 lg:flex-col">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex min-h-11 min-w-11 items-center text-[15px] text-ink-2 hover:text-ink"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          <h1 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[48px]">
            Seal every AI call
          </h1>
          <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink-2">
            One signed request right before your AI dials. Cachet checks your company and AI caller on
            Concordium, sends the person a card with a 4-digit code, and gives your AI the sentence to say
            first. Close the seal when the call ends.
          </p>
          <p className="mt-3 text-[15px] text-ink-2">
            API: <C>{API}</C> · Concordium testnet · Before your first seal,{' '}
            <Link href="/business" className="font-medium text-ink underline underline-offset-4">
              verify your company and register your AI caller
            </Link>{' '}
            (a few approvals in your Concordium wallet).
          </p>

          <H2 id="quickstart">Quickstart</H2>
          <P>
            With the TypeScript client from the{' '}
            <a
              className="font-medium text-ink underline underline-offset-4"
              href="https://github.com/Prashant-Mishra-12569/cachet/tree/main/packages/sdk"
            >
              Cachet repository
            </a>
            . Your AI signs with its own Concordium account key; Cachet never holds it.
          </P>
          <Code label="TypeScript">{`
import { createCachetClient } from '@cachet/sdk';

const cachet = createCachetClient({
  baseUrl: '${API}',
  badge: 'JyP9UD2cnf5bw2YzH1GTX',         // your AI caller's Verified badge
  account: AI_ACCOUNT,                    // the AI's own Concordium account
  signer: aiSigner,                       // its key (buildAccountSigner)
  fetch: x402Fetch,                       // pays a seal by itself when credits run out
});

// 1. right before dialling
const seal = await cachet.sealCall({
  to: '+31612345678',
  from: '+31201234567',                   // must be a registered calling number
  purpose: 'billing',
  message: 'Your November bill is ready', // shown on the card, 80 characters max
});

// 2. the first thing your AI says
agent.say(seal.firstLine);
// "Hi, this is Northwind Energy BV's AI assistant. Your Cachet code is four-seven, two-one."

// 3. when the call ends (retries through network drops for up to 2 minutes)
await cachet.closeSeal(seal.sealId, 'completed'); // or 'no_answer' | 'failed' | 'cancelled'
`}</Code>

          <H2 id="request">Ask for a seal</H2>
          <P>
            Any language works. Build the request, make its canonical form (RFC 8785, JSON Canonicalization
            Scheme), hash it, and sign the message with the AI&apos;s Concordium account using the wallet
            message-signing scheme (<C>signMessage</C> in the Concordium SDK).
          </P>
          <Code label="1 · The request (every field is required except amount; unknown fields are refused)">{`
{
  "v": "cachet-seal-request/1",
  "badge": "JyP9UD2cnf5bw2YzH1GTX",
  "agentAccount": "33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq",
  "to": "+31612345678",
  "from": "+31201234567",
  "purpose": "billing",
  "message": "Your November bill is ready",
  "amount": { "value": "12.40", "asset": "EUDemo" },
  "nonce": "9f1c0d6e2a7b4c3d8e5f60718293a4b5",   // 32–64 hex, single use
  "ts": 1764150000                               // unix seconds, ±120 s
}`}</Code>
          <Code label="2 · Sign">{`
digest    = sha256_hex( JCS(request) )
message   = "cachet:seal-request:v1:" + digest
signature = signMessage(agentAccount, message, aiKey)   // { "0": { "0": "<hex>" } }
`}</Code>
          <Code label="3 · Send">{`
POST ${API}/v1/seals
Content-Type: application/json

{ "request": { …as above… }, "signature": { "0": { "0": "…" } } }

201 Created
{
  "sealId": "01M89AG58PVJW8PJ5RQMP23PXA",
  "company": "Northwind Energy BV",
  "code": "47-21",
  "spokenCode": "four-seven, two-one",
  "firstLine": "Hi, this is Northwind Energy BV's AI assistant. Your Cachet code is four-seven, two-one.",
  "issuedAt": "2026-11-26T10:20:00.000Z",
  "expiresAt": "2026-11-26T10:35:00.000Z",
  "verifyUrl": "https://getcachet.site/v/01M89AG58PVJW8PJ5RQMP23PXA",
  "creditsLeft": 143
}`}</Code>
          <P>
            The person&apos;s card arrives in Telegram before the phone rings: in our 50-call test, half
            arrived within 0.5 s and 95% within 1.2 s. Say <C>firstLine</C> first: it tells the person they
            are talking to an AI and gives them the code to match. A newer seal from your AI to the same
            person replaces the old one.
          </P>

          <H2 id="pay">Pay per call (x402)</H2>
          <P>
            Each seal costs €0.01 in the digital-euro token, paid by your AI with x402, the HTTP 402 payment
            standard. With no credits left, <C>POST /v1/seals</C> answers <C>402</C> with a{' '}
            <C>PAYMENT-REQUIRED</C> header. An x402 client signs a token transfer and repeats the same request
            with <C>PAYMENT-SIGNATURE</C>. Cachet settles it on chain, then issues the seal;{' '}
            <C>PAYMENT-RESPONSE</C> carries the transaction. Network fees are sponsored, so the AI&apos;s
            account needs no CCD for this.
          </P>
          <Code label="Buy credits in bulk instead (1, 10, 100 or 1000)">{`
POST ${API}/v1/credits/purchase?credits=100&badge=JyP9UD2cnf5bw2YzH1GTX
→ 402 PAYMENT-REQUIRED (terms: €1.00 to Cachet's treasury)
→ repeat with PAYMENT-SIGNATURE → 200 { credits: 100, … } + PAYMENT-RESPONSE
`}</Code>

          <H2 id="close">Close the seal</H2>
          <P>
            When the call ends, close the seal so the person&apos;s card stops showing a verified call. Seals
            left open expire by themselves after 15 minutes.
          </P>
          <Code>{`
POST ${API}/v1/seals/{sealId}/close
{
  "request": {
    "v": "cachet-seal-close/1",
    "sealId": "01M89AG58PVJW8PJ5RQMP23PXA",
    "agentAccount": "33Rcud…",
    "reason": "completed",          // completed | no_answer | failed | cancelled
    "nonce": "…", "ts": 1764150090
  },
  "signature": signMessage(agentAccount, "cachet:seal-close:v1:" + sha256_hex(JCS(request)), aiKey)
}`}</Code>
          <P>
            Retry on network errors or 5xx with a fresh nonce. A <C>409 seal_not_open</C> means an earlier try
            already got through: treat it as done.
          </P>

          <H2 id="checks">What Cachet checks on every seal</H2>
          <ul className="mt-3 max-w-[68ch] list-disc space-y-1.5 pl-5 text-[16px] leading-relaxed text-ink-2">
            <li>The signature over the exact request, the single-use nonce and the time window.</li>
            <li>
              On chain, live: the AI caller is <strong className="text-ink">Active</strong> in the Concordium
              Agent Registry, owned by your verified company, has a payment wallet, and its card hash matches.
            </li>
            <li>Your company is verified and active in Cachet.</li>
            <li>
              <C>from</C> is a registered calling number and <C>purpose</C> a registered purpose.
            </li>
            <li>
              The message is short and has no links or long numbers (no &ldquo;call back on…&rdquo; tricks).
            </li>
            <li>The person has not blocked your company.</li>
            <li>A credit is spent, or the €0.01 x402 payment has settled.</li>
          </ul>

          <H2 id="verify">Verify a seal yourself</H2>
          <P>
            You don&apos;t have to trust Cachet&apos;s word. Each seal is signed with Cachet&apos;s Ed25519
            key and its fingerprint goes into a Merkle tree whose root is written to Concordium.
          </P>
          <Code>{`
GET ${API}/v1/seals/{sealId}               public view: company, AI caller, record proof
                                           (never the phone number or the call code)
GET https://getcachet.site/.well-known/cachet-keys.json     Cachet's public keys (JWK)

seal fingerprint  = sha256( JCS(seal) )
leaf              = sha256( 0x00 || fingerprint )
node              = sha256( 0x01 || min(a, b) || max(a, b) )        // sorted pair
on chain          = RegisterData( "CACHET1" || root )               // 39 bytes
`}</Code>
          <P>
            The public view includes the inclusion proof (sibling hashes, leaf to root) and the record
            transaction. Recompute the root and compare it with the transaction&apos;s data on any Concordium
            explorer. The full signed seal contains the call code, so only the person who was called receives
            it; they can check Cachet&apos;s signature offline with the public key.
          </P>

          <H2 id="mcp">Use it from an AI agent (MCP)</H2>
          <P>
            The Cachet MCP server lets any agent that speaks the Model Context Protocol (Claude, LangChain,
            voice-AI platforms) seal its calls by itself. It runs next to your agent, holds the AI&apos;s key
            locally and pays for seals with x402 (at most €0.05 per payment by default).
          </P>
          <ul className="mt-3 max-w-[68ch] list-disc space-y-1.5 pl-5 text-[16px] leading-relaxed text-ink-2">
            <li>
              <C>cachet_seal_call</C>: right before dialling. Returns the code and <C>firstLine</C>, the
              sentence to say first.
            </li>
            <li>
              <C>cachet_close_seal</C>: when the call ends.
            </li>
            <li>
              <C>cachet_check_company</C>: is a company verified, does it make AI calls, from which numbers?
            </li>
            <li>
              <C>cachet_check_seal</C>: what Cachet checked for one seal.
            </li>
          </ul>
          <Code label="Claude Desktop (claude_desktop_config.json) or any MCP client">{`
{
  "mcpServers": {
    "cachet": {
      "command": "pnpm",
      "args": ["-s", "--dir", "/path/to/cachet", "--filter", "@cachet/mcp", "start"],
      "env": {
        "CACHET_AGENT_BADGE": "JyP9UD2cnf5bw2YzH1GTX",
        "CCD_AGENT_ADDRESS": "<your AI's Concordium account>",
        "CCD_AGENT_KEY_PATH": "/safe/place/agent.export",
        "CACHET_CALLER_ID": "+31201234567"
      }
    }
  }
}`}</Code>
          <P>
            The key file never leaves your machine. To see it work, run <C>pnpm mcp:example +31612345678</C>:
            an example agent connects, checks a company, seals, checks the seal and closes it.
          </P>

          <H2 id="errors">Errors</H2>
          <P>
            Errors are JSON: <C>{'{ "error": { "code": "…", "message": "…" } }'}</C>. The message is safe to
            show to people. Common codes:
          </P>
          <div className="mt-4 overflow-x-auto rounded-[16px] border border-line bg-surface">
            <table className="w-full text-left text-[14px]">
              <thead className="text-ink-2">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    HTTP
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Code
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Meaning
                  </th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map(([status, code, meaning]) => (
                  <tr key={code} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 tabular-nums">{status}</td>
                    <td className="px-4 py-2.5 font-mono text-[13px] whitespace-nowrap">{code}</td>
                    <td className="px-4 py-2.5 text-ink-2">{meaning.replace(/`/g, '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>Rate limits: 600 seal requests and 600 closes per 10 minutes per IP address.</P>

          <H2 id="threats">Threat model</H2>
          <P>How each attack is stopped today, and what is still planned.</P>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {THREATS.map(([attack, defence, state]) => (
              <li key={attack} className="rounded-[16px] border border-line bg-surface p-4">
                <p className="flex items-start justify-between gap-3 font-semibold">
                  {attack}
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                      state === 'built' ? 'bg-seal-soft text-seal' : 'border border-line text-ink-2'
                    }`}
                  >
                    {state === 'built' ? 'In place' : 'Planned'}
                  </span>
                </p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{defence}</p>
              </li>
            ))}
          </ul>

          <H2 id="concordium">Built on Concordium</H2>
          <P>
            Every piece runs on the Concordium test network today. Open any transaction to see it on chain.
          </P>
          <ul className="mt-4 divide-y divide-line rounded-[16px] border border-line bg-surface">
            {ONCHAIN.map(([name, what, hash]) => (
              <li
                key={hash}
                className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div>
                  <p className="font-semibold">{name}</p>
                  <p className="mt-0.5 max-w-[60ch] text-[15px] text-ink-2">{what}</p>
                </div>
                <a
                  href={tx(hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 shrink-0 items-center font-mono text-[13px] text-ink underline underline-offset-4"
                >
                  {hash.slice(0, 10)}…{hash.slice(-6)}
                  <span className="sr-only"> (opens the transaction on the Concordium explorer)</span>
                </a>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}
