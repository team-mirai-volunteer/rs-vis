import type { Metadata } from 'next';
import { PAGES, PRODUCT_NAME } from '@/components/navigation/pages';
import { SITE_URL } from './site-url';

export const SHARE_PAGES = [
  { href: '/', label: '国の予算を、もっと身近に。', description: '国の予算・支出先・事業評価をたどり、税や政策の選択を考える。チームみらいの行政事業レビュー可視化。' },
  ...PAGES,
];
export const socialImagePath = (path: string) => `/og/${path === '/' ? 'home' : path.slice(1)}.png`;

export function pageMetadata(path: string): Metadata {
  const page = SHARE_PAGES.find(page => page.href === path);
  if (!page) throw new Error(`Unknown public page: ${path}`);
  const title = `${page.label}｜${PRODUCT_NAME}`;
  const url = new URL(path, SITE_URL).href;
  const image = { url: new URL(socialImagePath(path), SITE_URL).href, width: 1200, height: 630, alt: `${page.label} — チームみらい ${PRODUCT_NAME}` };
  return {
    title, description: page.description, alternates: { canonical: url },
    openGraph: { title, description: page.description, url, siteName: PRODUCT_NAME, locale: 'ja_JP', type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description: page.description, images: [image.url] },
  };
}
