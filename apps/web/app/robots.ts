import type { MetadataRoute } from 'next';

const SITE = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://getcachet.site';

export default function robots(): MetadataRoute.Robots {
  return {
    // Telegram Mini App, payments, compliance reports and the API are never for search engines.
    rules: { userAgent: '*', allow: '/', disallow: ['/tg/', '/pay/', '/business/report', '/v1/'] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
