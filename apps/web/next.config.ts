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

const nextConfig: NextConfig = {
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
