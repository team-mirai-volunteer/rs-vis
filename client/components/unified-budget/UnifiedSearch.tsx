'use client';

/**
 * ノード検索とフィルタの入り口。`/mof-sankey` の SankeyChartSearch を統合ビューの型に合わせたもの。
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { UNIFIED_COLUMN_LABELS } from '@/types/unified-budget';
import type { UnifiedViewNode } from '@/types/unified-budget-view';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_RESULTS = 30;
const MIN_QUERY_LENGTH = 2;

export function UnifiedSearch({
  nodes,
  onSelect,
  filterFields,
  filterOpen,
  onToggleFilter,
}: {
  nodes: UnifiedViewNode[];
  onSelect: (id: string) => void;
  filterFields: ReactNode;
  filterOpen: boolean;
  onToggleFilter: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) return [];
    return nodes
      .filter(n => !n.details.aggregated && n.name.includes(q))
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_RESULTS);
  }, [nodes, query]);

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
    setQuery('');
    setCursor(-1);
  };

  return (
    <div className="relative" data-pan-disabled="true">
      <div className="flex items-center gap-1 rounded-full border border-mirai-border bg-card px-2.5 shadow-xs">
        <Search className="size-3.5 shrink-0 text-mirai-text-muted" aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="ノードを検索（2文字以上）"
          aria-label="ノードを検索"
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            setCursor(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor(c => Math.min(results.length - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor(c => Math.max(-1, c - 1));
            } else if (e.key === 'Enter' && cursor >= 0 && results[cursor]) {
              choose(results[cursor].id);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="h-8 w-44 bg-transparent text-xs text-mirai-text placeholder:text-mirai-text-placeholder outline-none"
        />
        <Button
          variant="ghost"
          size="xs"
          title={filterOpen ? '絞り込みを閉じる' : '絞り込みを開く'}
          aria-label={filterOpen ? '絞り込みを閉じる' : '絞り込みを開く'}
          aria-expanded={filterOpen}
          onClick={onToggleFilter}
          className={cn('h-6 px-1.5 text-[11px]', filterOpen ? 'bg-mirai-surface-teal text-primary-accent' : 'text-mirai-text-muted')}
        >
          絞込
        </Button>
      </div>
      {open && results.length > 0 && (
        <div ref={listRef} className="absolute left-0 top-9 z-40 max-h-80 w-80 overflow-y-auto rounded-xl border border-mirai-border bg-card p-1 shadow-soft">
          {results.map((n, i) => (
            <Button
              key={n.id}
              variant="ghost"
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(n.id)}
              className={cn('flex h-auto w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left text-xs font-normal hover:bg-mirai-surface', i === cursor && 'bg-mirai-surface-teal')}
            >
              <span className="min-w-0 truncate text-mirai-text-secondary">
                <span className="mr-1 text-[10px] text-mirai-text-muted">{UNIFIED_COLUMN_LABELS[n.details.column]}</span>
                {n.name}
              </span>
              <span className="shrink-0 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(n.value)}</span>
            </Button>
          ))}
        </div>
      )}
      {filterOpen && (
        <div className="absolute left-0 top-9 z-40 w-96 rounded-xl border border-mirai-border bg-card p-1 shadow-soft" data-pan-disabled="true">
          {filterFields}
        </div>
      )}
    </div>
  );
}
