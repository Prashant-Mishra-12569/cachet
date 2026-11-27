import { NextResponse, type NextRequest } from 'next/server';

/**
 * API requests (/v1/*) are forwarded to the Cachet server, which would otherwise see only this
 * website's IP for every visitor (so one person could use up everyone's rate limits). We pass the
 * visitor's real IP, with a secret only this website and the server know. Copies of these headers
 * sent by the visitor are always removed first.
 *
 * The proxy forwards the request itself (rather than leaving it to the rewrite in next.config), so the
 * headers it sets always reach the server on Vercel too.
 */
const API_URL = (process.env['API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '');

export function proxy(request: NextRequest) {
  const secret = process.env['CACHET_PROXY_SECRET'] ?? '';
  const headers = new Headers(request.headers);
  headers.delete('x-cachet-proxy-secret');
  headers.delete('x-cachet-client-ip');
  // On Vercel these are set by Vercel itself (a visitor can't choose them).
  const ip =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (secret && ip) {
    headers.set('x-cachet-proxy-secret', secret);
    headers.set('x-cachet-client-ip', ip);
  }
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, API_URL);
  const response = NextResponse.rewrite(target, { request: { headers } });
  // Says only WHETHER it works (never the secret or the IP), so it can be checked from outside.
  response.headers.set('x-cachet-proxy', !secret ? 'no-secret' : ip ? 'visitor-ip' : 'no-ip');
  return response;
}

export const config = { matcher: '/v1/:path*' };
