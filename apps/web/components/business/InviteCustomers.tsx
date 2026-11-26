'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { BOT_USERNAME } from '@/lib/telegram';
import { card } from './ui';

/**
 * Protect your customers: a personal invite link + QR + ready-to-send messages. People who join
 * through it are counted (a number only: Cachet never tells a company who joined).
 */
export function InviteCustomers({ companyName }: { companyName: string }) {
  const [invite, setInvite] = useState<{ code: string; joined: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ code: string; joined: number }>('/v1/business/invite')
      .then(setInvite)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Could not load your invite link.'),
      );
  }, []);

  const link = invite ? `https://t.me/${BOT_USERNAME}?start=co_${invite.code}` : '';

  useEffect(() => {
    if (!link) return;
    let live = true;
    // Loaded only here, so the QR library never weighs on other pages.
    void import('qrcode').then((QR) =>
      QR.toString(link, { type: 'svg', margin: 1, color: { dark: '#0E0E0C', light: '#FFFFFF' } }).then(
        (svg) => live && setQr(svg),
      ),
    );
    return () => {
      live = false;
    };
  }, [link]);

  const messages = [
    {
      id: 'sms',
      label: 'SMS / WhatsApp',
      text: `Is it really ${companyName} calling? Get a free alert in Telegram that shows when our AI assistant really calls you: ${link}`,
    },
    {
      id: 'email',
      label: 'Email',
      text: `Dear customer,\n\nScammers now use AI voices to pretend to be companies like ours. To protect you, ${companyName} uses Cachet: whenever our AI assistant really calls you, a green card with a 4-digit code appears in your Telegram first, and our assistant says the same code. No card means it isn't us.\n\nIt's free and takes 30 seconds: ${link}\n\n${companyName}`,
    },
    {
      id: 'web',
      label: 'Website or app',
      text: `Is it really ${companyName} calling? Turn on free call verification in Telegram: ${link}`,
    },
  ];

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  const downloadQr = () => {
    if (!qr) return;
    const url = URL.createObjectURL(new Blob([qr], { type: 'image/svg+xml' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'cachet-invite-qr.svg' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={card} aria-labelledby="invite-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="invite-title" className="text-lg font-semibold">
            Protect your customers
          </h2>
          <p className="mt-1 max-w-[60ch] text-[15px] text-ink-2">
            Cachet can only show your verified calls to people who joined. Send them this link: they see your
            name when they join, and from then on every real call from you arrives with a green card first.
          </p>
        </div>
        {invite ? (
          <p className="rounded-full bg-seal-soft px-3 py-1 text-[14px] font-medium text-seal">
            {invite.joined} {invite.joined === 1 ? 'customer' : 'customers'} joined through your link
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-alert-soft px-4 py-3 text-alert">
          {error}
        </p>
      ) : !invite ? (
        <p className="mt-4 text-sm text-ink-2">Making your invite link…</p>
      ) : (
        <div className="mt-5 grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="text-[13px] text-ink-2">Your invite link</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[12px] border border-line bg-bg px-3 py-2.5 font-mono text-[14px]">
                {link}
              </code>
              <button
                type="button"
                onClick={() => void copy('link', link)}
                className="min-h-11 rounded-full bg-ink px-4 text-sm font-medium text-white"
              >
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
            </div>

            <p className="mt-5 text-[13px] text-ink-2">Ready-to-send messages</p>
            <ul className="mt-2 flex flex-col gap-3">
              {messages.map((m) => (
                <li key={m.id} className="rounded-[14px] border border-line p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{m.label}</span>
                    <button
                      type="button"
                      onClick={() => void copy(m.id, m.text)}
                      className="min-h-11 rounded-full border border-line px-4 text-sm font-medium hover:bg-bg"
                    >
                      {copied === m.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="mt-1 text-[14px] leading-snug whitespace-pre-line text-ink-2">{m.text}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div
              className="size-44 rounded-[16px] border border-line bg-white p-2 [&_svg]:size-full"
              role="img"
              aria-label="QR code of your invite link"
              // The SVG comes from the qrcode library, built from our own link only.
              dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
            />
            <button
              type="button"
              onClick={downloadQr}
              disabled={!qr}
              className="min-h-11 rounded-full border border-line px-4 text-sm font-medium hover:bg-bg disabled:opacity-50"
            >
              Download QR
            </button>
            <p className="max-w-[22ch] text-center text-[12px] text-ink-2">
              For letters, bills and your shop.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
