'use client';

import { useEffect, useState } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';
import { usePathname } from 'next/navigation';
import { shouldLoadGoogleAnalytics } from '@/app/lib/google-analytics';

/**
 * サイト全体の GA4 タグ。呼び出し側が本番（VERCEL_ENV=production）のときだけ置く。
 * `/admin` では描画しない。cookie_domain は渡さず、gtag の既定のままにする。
 *
 * 未一致 URL の 404 は静的な not-found を共有するため、サーバー描画ではスクリプトを出さない。
 * マウント後に実パスを見て、/admin 以外のときだけ GoogleAnalytics を足す。
 */
export function SiteGoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || !shouldLoadGoogleAnalytics(pathname)) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
