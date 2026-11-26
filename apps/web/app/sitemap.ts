import type { MetadataRoute } from 'next';

const SITE = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://getcachet.site';

/** Public pages only. Seal pages, the Mini App and payment pages are private and not listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/business', '/developers', '/status', '/privacy', '/terms'].map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: path === '' || path === '/status' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.6,
  }));
}
