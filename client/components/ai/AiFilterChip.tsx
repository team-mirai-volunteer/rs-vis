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

export function AiFilterChip({ filter, sheetYear, onClear, className }: {
  filter: AiListFilter;
  /** RS シート年度（サンキー図へのリンクに使う） */
  sheetYear: number | string;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-primary/30 bg-mirai-surface-teal py-1 pl-3 pr-1 text-xs text-mirai-text', className)} data-testid="ai-list-filter">
      <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-primary-accent" />
      <span className="font-medium">AI の条件:</span>
      <span className="min-w-0 truncate" title={filter.summary}>{filter.summary}</span>
      {filter.unsupported.length > 0 && (
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
