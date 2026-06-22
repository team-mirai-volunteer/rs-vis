import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/app/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['/sankey-svg', '/subcontracts', '/mof-budget-overview', '/quality'];
  return pages.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'monthly',
    priority: path === '/sankey-svg' ? 1 : 0.7,
  }));
}
