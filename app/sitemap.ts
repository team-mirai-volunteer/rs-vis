import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/app/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['/', '/budget-sankey', '/subcontracts', '/mof-budget-overview', '/quality', '/project-bubble', '/tax-burden'];
  return pages.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'monthly',
    priority: path === '/' || path === '/budget-sankey' ? 1 : 0.7,
  }));
}
