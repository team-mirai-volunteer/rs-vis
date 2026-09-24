'use client';

import { fiscalNavigationUrl } from '@/app/lib/rs-fiscal-year';
import { useState } from 'react';
import Link from 'next/link';
import { Check, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PAGES, type NavPageHref } from './pages';

export type { NavPageHref } from './pages';

/**
 * ページ切替のハンバーガーメニュー（全ビュー一覧）。通常は AppHeader の右端に置かれる。
 * ページ一覧は ./pages.ts で AppHeader の主要ナビ・トップページと共有する。
 *
 * 見た目はチームみらいデザインシステム（.claude/skills/SKILL.md）に従う:
 * 白カード + rounded-xl + mirai-border、現在ページは primary-accent で示す。
 */
export function PageNavMenu({
  current,
  fiscalYear,
}: {
  current: NavPageHref | '/';
  fiscalYear?: number;
  /** 互換用。デザインシステム適用後は常にライト配色のため未使用 */
  theme?: 'auto' | 'light';
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(v => !v)}
        aria-label="ページ切替メニュー"
        aria-expanded={open}
        className="border-mirai-border"
      >
        <Menu />
      </Button>
      {open && (
        <>
          {/* メニュー外クリックで閉じる */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-mirai-border bg-card p-1 text-xs shadow-soft">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              aria-current={current === '/' ? 'page' : undefined}
              className={cn(
                'mb-1 flex items-center justify-between rounded-lg border-b border-border px-2.5 py-1.5 transition-colors',
                current === '/' ? 'font-bold text-primary-accent' : 'font-medium text-mirai-text hover:bg-mirai-surface'
              )}
            >
              トップ
              {current === '/' && <Check className="size-3.5" aria-hidden="true" />}
            </Link>
            {PAGES.map(item => {
              const isCurrent = item.href === current;
              return (
                <Link
                  key={item.href}
                  href={fiscalNavigationUrl(item.href, fiscalYear)}
                  onClick={() => setOpen(false)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-colors',
                    isCurrent
                      ? 'font-bold text-primary-accent'
                      : 'font-medium text-mirai-text hover:bg-mirai-surface'
                  )}
                >
                  {item.label}
                  {isCurrent && <Check className="size-3.5" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
}
