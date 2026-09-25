'use client';

import { fiscalNavigationUrl } from '@/app/lib/rs-fiscal-year';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Menu } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PAGES, type NavPageHref } from './pages';

const MENU_GROUPS = [
  { heading: '主なビュー', pages: PAGES.filter(p => p.primary) },
  { heading: '財務省予算書', pages: PAGES.filter(p => !p.primary) },
];

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
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
          <nav aria-label="全ページ" className="absolute right-0 top-11 z-50 max-h-[calc(100dvh-5rem)] w-64 overflow-y-auto rounded-xl border border-mirai-border bg-card p-1.5 text-sm shadow-soft">
            <MenuLink href="/" label="トップ" isCurrent={current === '/'} onSelect={() => setOpen(false)} />
            {MENU_GROUPS.map(group => (
              <div key={group.heading} className="mt-1 border-t border-border pt-1">
                <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-bold text-mirai-text-muted">{group.heading}</p>
                {group.pages.map(item => (
                  <MenuLink
                    key={item.href}
                    href={fiscalNavigationUrl(item.href, fiscalYear)}
                    label={item.navLabel}
                    prototype={item.prototype}
                    isCurrent={item.href === current}
                    onSelect={() => setOpen(false)}
                  />
                ))}
              </div>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, label, prototype = false, isCurrent, onSelect }: {
  href: string;
  label: string;
  prototype?: boolean;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
        isCurrent ? 'bg-mirai-surface-teal font-bold text-primary-accent' : 'font-medium text-mirai-text hover:bg-mirai-surface'
      )}
    >
      <span className="min-w-0 flex-1">{label}</span>
      {prototype && <Badge variant="muted" className="px-1.5 text-[10px]">試作</Badge>}
      {isCurrent && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
    </Link>
  );
}
