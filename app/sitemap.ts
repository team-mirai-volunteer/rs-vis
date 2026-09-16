import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/app/lib/site-url';
import { SHARE_PAGES } from '@/app/lib/page-metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = SHARE_PAGES.map(page => page.href);
  return pages.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'monthly',
    priority: path === '/' || path === '/budget-sankey' ? 1 : 0.7,
  }));
}
