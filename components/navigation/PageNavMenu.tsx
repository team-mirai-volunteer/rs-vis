'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * ページ切替のハンバーガーメニュー。公開4ビューを行き来する共通ナビ。
 * /project-bubble で使っていたものを共通化した。年度セレクトは年度の持ち方が
 * ページごとに違う（state / URL / ルータ）ため、各ページ側で隣に並べる。
 *
 * 見た目はチームみらいデザインシステム（.claude/skills/SKILL.md）に従う:
 * 白カード + rounded-xl + mirai-border、現在ページは primary-accent で示す。
 */

const PAGES = [
  { href: '/quality', label: '評価' },
  { href: '/sankey-svg', label: 'サンキー図' },
  { href: '/budget-sankey', label: '統合ビュー' },
  { href: '/project-bubble', label: 'バブルチャート' },
  { href: '/subcontracts', label: '委託構造' },
  { href: '/mof-budget-overview', label: '予算全体（MOF）' },
  { href: '/mof-jikou', label: '予算書 事項（MOF）' },
  { href: '/mof-kou-moku', label: '予算書 科目別内訳（MOF）' },
  { href: '/mof-kou', label: '予算書 項一覧（MOF）' },
  { href: '/mof-hierarchy', label: '予算書 階層フロー（MOF）' },
  { href: '/mof-sankey', label: '予算書 項×RS事業（MOF）' },
] as const;

export type NavPageHref = (typeof PAGES)[number]['href'];

export function PageNavMenu({
  current,
}: {
  current: NavPageHref;
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
          <nav className="absolute right-0 top-11 z-50 w-52 rounded-xl border border-mirai-border bg-card p-1 text-xs shadow-soft">
            {PAGES.map(item => {
              const isCurrent = item.href === current;
              return (
                <Link
                  key={item.href}
                  href={item.href}
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
