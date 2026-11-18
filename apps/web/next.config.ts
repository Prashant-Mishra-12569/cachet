import type { NextConfig } from 'next';

/** Where the Cachet server runs. The browser only talks to this website; /v1/* is forwarded. */
const API_URL = (process.env['API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@cachet/shared'],
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${API_URL}/v1/:path*` }];
  },
};

export default nextConfig;
