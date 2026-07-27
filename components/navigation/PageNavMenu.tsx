'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * ページ切替のハンバーガーメニュー。公開4ビューを行き来する共通ナビ。
 * /project-bubble で使っていたものを共通化した。年度セレクトは年度の持ち方が
 * ページごとに違う（state / URL / ルータ）ため、各ページ側で隣に並べる。
 */

const PAGES = [
  { href: '/quality', label: '評価' },
  { href: '/sankey-svg', label: 'サンキー図' },
  { href: '/project-bubble', label: 'バブルチャート' },
  { href: '/subcontracts', label: '委託構造' },
  { href: '/mof-budget-overview', label: '予算全体（MOF）' },
] as const;

export type NavPageHref = (typeof PAGES)[number]['href'];

export function PageNavMenu({
  current,
  theme = 'auto',
}: {
  current: NavPageHref;
  /** 'light' はライト配色固定のページ（/sankey-svg 等）用。OSダーク時の浮きを防ぐ */
  theme?: 'auto' | 'light';
}) {
  const [open, setOpen] = useState(false);
  const dark = theme === 'auto';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="ページ切替メニュー"
        aria-expanded={open}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white/90 text-neutral-600 shadow-md backdrop-blur hover:bg-white ${
          dark ? 'dark:border-white/10 dark:bg-neutral-900/90 dark:text-neutral-300 dark:hover:bg-neutral-800' : ''
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          {/* メニュー外クリックで閉じる */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav className={`absolute right-0 top-10 z-50 w-44 rounded-xl border border-black/10 bg-white/95 p-1 text-xs shadow-lg backdrop-blur ${
            dark ? 'dark:border-white/10 dark:bg-neutral-900/95' : ''
          }`}>
            {PAGES.map(item => {
              const isCurrent = item.href === current;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${
                    isCurrent
                      ? `font-semibold text-neutral-900 ${dark ? 'dark:text-neutral-100' : ''}`
                      : `text-neutral-600 hover:bg-black/5 ${dark ? 'dark:text-neutral-300 dark:hover:bg-white/10' : ''}`
                  }`}
                >
                  {item.label}
                  {isCurrent && <span aria-hidden="true">✓</span>}
                </Link>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
}
