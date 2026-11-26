import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

/** Where the Cachet server runs. The browser only talks to this website; /v1/* is forwarded. */
const API_URL = (process.env['API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '');

/**
 * Public (non-secret) values the browser needs, taken from the repo-root .env one by one.
 * Never load the whole root .env here: it holds server secrets.
 */
function rootPublic(name: string): string {
  if (process.env[name]) return process.env[name] ?? '';
  const file = new URL('../../.env', import.meta.url);
  if (!existsSync(file)) return '';
  return parseEnv(readFileSync(file, 'utf8'))[name] ?? '';
}

/**
 * Content Security Policy: where pages may load code and data from. Scripts only from this site and
 * Telegram's Mini App script; network only to this site and the WalletConnect relay (paying from a
 * phone wallet). 'unsafe-inline' scripts are needed by Next.js's inline page data; no other site's
 * code can run, and nothing can be loaded as a plugin.
 */
const csp = (frameAncestors: string) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://*.reown.com wss://*.reown.com",
    "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Nobody may show our pages inside their own (clickjacking: hidden "sign" or "pay" buttons)...
      {
        source: '/((?!tg$|tg/).*)',
        headers: [
          ...common,
          { key: 'Content-Security-Policy', value: csp("'none'") },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      // ...except Telegram, which shows the Mini App inside its web version.
      {
        source: '/tg/:path*',
        headers: [
          ...common,
          {
            key: 'Content-Security-Policy',
            value: csp("'self' https://web.telegram.org https://*.telegram.org"),
          },
        ],
      },
      {
        source: '/tg',
        headers: [
          ...common,
          {
            key: 'Content-Security-Policy',
            value: csp("'self' https://web.telegram.org https://*.telegram.org"),
          },
        ],
      },
    ];
  },
  env: {
    // WalletConnect Cloud project id (public; identifies the app to the WalletConnect relay).
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: rootPublic('WALLETCONNECT_PROJECT_ID'),
  },
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@cachet/shared'],
  // Local Mini App testing goes through an https tunnel to this dev server (Telegram needs https).
  allowedDevOrigins: ['*.trycloudflare.com'],
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${API_URL}/v1/:path*` },
      // Cachet's public seal-signing key, so anyone can verify seals offline.
      { source: '/.well-known/cachet-keys.json', destination: `${API_URL}/.well-known/cachet-keys.json` },
    ];
  },
};

export default nextConfig;
