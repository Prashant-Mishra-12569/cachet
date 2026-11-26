import { NextResponse, type NextRequest } from 'next/server';

/**
 * API requests (/v1/*) are forwarded to the Cachet server, which would otherwise see only this
 * website's IP for every visitor (so one person could use up everyone's rate limits). We pass the
 * visitor's real IP, with a secret only this website and the server know. Copies of these headers
 * sent by the visitor are always removed first.
 */
const SECRET = process.env['CACHET_PROXY_SECRET'] ?? '';

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('x-cachet-proxy-secret');
  headers.delete('x-cachet-client-ip');
  // On Vercel these are set by Vercel itself (a visitor can't choose them).
  const ip =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (SECRET && ip) {
    headers.set('x-cachet-proxy-secret', SECRET);
    headers.set('x-cachet-client-ip', ip);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/v1/:path*' };
