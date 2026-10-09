'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * スマホ幅（640px 未満）だけ画面下部に固定する主 CTA。
 * 冒頭（hero）と最後の CTA セクションが見えている間は隠す（同じボタンが 2 つ並ぶため）。
 * lp-production スキル「主CTAのセクション」「モバイル」の作法。
 */
export function MobileCta({ href, label, watch }: { href: string; label: string; watch: string[] }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const targets = watch.map(id => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!targets.length) { setHidden(false); return; }
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); }
      setHidden(visible.size > 0);
    }, { threshold: 0.15 });
    targets.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [watch]);
  return (
    <div aria-hidden={hidden} className={`fixed inset-x-0 bottom-0 z-30 border-t border-mirai-border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-transform duration-300 sm:hidden ${hidden ? 'translate-y-full' : 'translate-y-0'}`}>
      <Button asChild size="lg" className="h-12 w-full" tabIndex={hidden ? -1 : undefined}>
        <Link href={href}>{label} <ArrowRight /></Link>
      </Button>
    </div>
  );
}
