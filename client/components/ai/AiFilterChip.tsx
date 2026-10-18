'use client';

/**
 * 一覧型のページで、AI ナビの条件を当てていることを示すチップ。× で外す。
 * このページで当てられなかった条件があれば、その旨と「サンキー図で見る」リンクを添える。
 */
import Link from 'next/link';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AiListFilter } from '@/client/lib/ai/list-filter';
import { sankeyUrlForQuery } from '@/client/lib/ai/result-links';

export function AiFilterChip({ filter, sheetYear, onClear, className, compact = false }: {
  filter: AiListFilter;
  /** RS シート年度（サンキー図へのリンクに使う） */
  sheetYear: number | string;
  onClear: () => void;
  className?: string;
  /** 条件の説明を出さず「AI の条件 ×」だけにする（詰まったフィルター行に置くとき。説明はホバーで） */
  compact?: boolean;
}) {
  const hint = filter.resolving ? `${filter.summary}（支出先などの条件を適用中…）` : filter.unsupported.length > 0 ? `${filter.summary}（${filter.unsupported.join('・')}は未適用）` : filter.summary;
  if (compact) {
    return (
      <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-mirai-surface-teal pl-2 pr-0.5 text-[11px] text-mirai-text', className)} title={hint} data-testid="ai-list-filter">
        <Sparkles aria-hidden="true" className="size-3 shrink-0 text-primary-accent" />
        <span className="font-medium">AI の条件</span>
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="AI の条件を外す" title="AI の条件を外す" className="size-5 text-mirai-text-muted hover:bg-card hover:text-mirai-text">
          <X className="size-3" aria-hidden="true" />
        </Button>
      </span>
    );
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-primary/30 bg-mirai-surface-teal py-1 pl-3 pr-1 text-xs text-mirai-text', className)} data-testid="ai-list-filter">
      <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-primary-accent" />
      <span className="font-medium">AI の条件:</span>
      <span className="min-w-0 truncate" title={filter.summary}>{filter.summary}</span>
      {filter.resolving && <span className="text-mirai-text-muted">（支出先などの条件を適用中…）</span>}
      {!filter.resolving && filter.unsupported.length > 0 && (
        <span className="text-mirai-text-muted" title={`このページでは判定できない条件: ${filter.unsupported.join('、')}`}>
          （{filter.unsupported.join('・')}は未適用。<Link href={sankeyUrlForQuery(filter.query, sheetYear)} className="text-primary-accent underline-offset-4 hover:underline">サンキー図で見る</Link>）
        </span>
      )}
      <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="AI の条件を外す" title="AI の条件を外す" className="size-5 text-mirai-text-muted hover:bg-card hover:text-mirai-text">
        <X className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}
