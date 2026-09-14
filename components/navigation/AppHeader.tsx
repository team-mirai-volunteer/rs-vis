'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PageNavMenu } from './PageNavMenu';
import { PRIMARY_PAGES, PRODUCT_NAME, type NavPageHref } from './pages';

/**
 * 全ページ共通の浮島ヘッダー（チームみらいデザインシステム §7「固定ヘッダー」）。
 * 白い rounded-2xl のカードが warm gray の地に浮く。左にワードマークと製品名、
 * 中央（xl 以上）に主要ナビ、右に各ページ固有のコントロール（年度セレクト等）と全件メニュー。
 *
 * 高さは globals.css の `--app-header-h`（72px = 上下 12px + 島 48px。下の 12px がサイドパネルやキャンバスとの隙間）。
 * - `position="static"`（既定）: 縦 flex のページで最初の子として置く
 * - `position="fixed"`: 全画面キャンバス型ページで使う。キャンバス側は
 *   `top: var(--app-header-h)` から始める（`fixed inset-x-0 bottom-0 top-[var(--app-header-h)]`）
 */
export function AppHeader({
  current,
  children,
  position = 'static',
  className,
}: {
  current: NavPageHref | '/';
  /** 右側スロット。YearSelect・ViewSelect・「データについて」など、ページ固有のコントロール */
  children?: ReactNode;
  position?: 'static' | 'fixed';
  className?: string;
}) {
  return (
    <header
      data-pan-disabled="true"
      className={cn(
        'z-40 shrink-0 px-3 py-3',
        position === 'fixed' && 'pointer-events-none fixed inset-x-0 top-0',
        className
      )}
    >
      <div className="pointer-events-auto flex h-12 items-center gap-3 rounded-2xl border border-mirai-border bg-card px-4 shadow-xs">
        <Link href="/" className="flex shrink-0 items-center gap-3 transition-opacity hover:opacity-80" aria-label={`${PRODUCT_NAME} トップ`}>
          <Image src="/logos/team-mirai-wordmark.svg" alt="チームみらい" width={110} height={17} className="h-[17px] w-auto" priority />
          <span className="hidden border-l border-mirai-border pl-3 text-sm font-bold text-mirai-text sm:inline">{PRODUCT_NAME}</span>
        </Link>

        <nav aria-label="主要ビュー" className="ml-4 hidden min-w-0 items-center gap-1 overflow-hidden xl:flex">
          {PRIMARY_PAGES.map(item => {
            const isCurrent = item.href === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors',
                  isCurrent
                    ? 'bg-mirai-surface-teal font-bold text-primary-accent'
                    : 'font-medium text-mirai-text-subtle hover:bg-mirai-surface hover:text-mirai-text'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {children}
          <PageNavMenu current={current} />
        </div>
      </div>
    </header>
  );
}
