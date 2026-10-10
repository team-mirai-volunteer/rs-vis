'use client';

/**
 * 事業の詳細に出す「関連ページ」。RS や予算書では粒度が足りない事業で、原資料を公表している省庁のページへ案内する 1 行。
 * 一覧は app/lib/related-pages.ts（手で選んだ確認済み URL）。該当が無い事業では何も出さない。
 */
import { relatedPagesFor } from '@/app/lib/related-pages';

export function ProjectRelatedPages({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const pages = relatedPagesFor(pid);
  if (pages.length === 0) return null;
  return <section aria-label="関連ページ" className={`flex items-baseline gap-[5px] ${padding}`} style={{ fontSize: scaleFont(11) }}>
    <span className="shrink-0 font-bold text-mirai-text-subtle">関連ページ</span>
    <ul className="min-w-0 flex-1 space-y-0.5" style={{ fontSize: scaleFont(10) }}>
      {pages.map(page => <li key={page.url} className="truncate" title={page.note}>
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent">{page.label} ↗</a>
      </li>)}
    </ul>
  </section>;
}
