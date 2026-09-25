'use client';

/**
 * ノード検索とフィルタの入り口。`/mof-sankey` の SankeyChartSearch を統合ビューの型に合わせたもの。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UNIFIED_COLUMN_LABELS } from '@/types/unified-budget';
import type { UnifiedViewNode } from '@/types/unified-budget-view';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { Search, X } from 'lucide-react';
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
  onApplyQuery,
  trailing,
  filterActive = false,
  onClearFilter,
}: {
  nodes: UnifiedViewNode[];
  onSelect: (id: string) => void;
  filterFields: ReactNode;
  filterOpen: boolean;
  onToggleFilter: () => void;
  onApplyQuery: (query: string) => void;
  /** 「絞込」の右、解除 × の左に並べる同体裁のボタン（AI絞り込みなど）。並びは 絞込 → AI → × */
  trailing?: ReactNode;
  /** 絞り込み条件が有効か。有効なら「絞込」を強調し、隣に解除 × を出す（独立アイコンをピルの外に置かない） */
  filterActive?: boolean;
  onClearFilter?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 絞り込みパネルは、外（図のノードや他のコントロール）を押したら閉じる。
  // 開いたまま残ると図の左上を塞ぎ続けて邪魔になるため。中の入力操作では閉じない
  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onToggleFilter();
    };
    // capture 段階で拾う。図のノードは mousedown の伝播を止めるので、バブリングでは document に届かない
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [filterOpen, onToggleFilter]);

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
    <div ref={rootRef} className="relative" data-pan-disabled="true">
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
          onClick={() => {
            const value = query.trim();
            setOpen(false);
            setCursor(-1);
            if (value) onApplyQuery(value);
            onToggleFilter();
          }}
          className={cn('h-6 px-1.5 text-[11px]', filterOpen || filterActive ? 'bg-mirai-surface-teal text-primary-accent' : 'text-mirai-text-muted')}
        >
          絞込{filterActive && <span aria-hidden="true" className="ml-0.5 inline-block size-1.5 rounded-full bg-primary-accent align-middle" />}
        </Button>
        {trailing}
        {filterActive && onClearFilter && (
          <Button variant="ghost" size="icon-sm" title="絞り込みを解除" aria-label="絞り込みを解除" onClick={() => {
            setQuery('');
            setOpen(false);
            setCursor(-1);
            onClearFilter();
          }}
            className="size-5 text-mirai-text-muted hover:bg-mirai-surface-teal hover:text-mirai-text">
            <X className="size-3" aria-hidden="true" />
          </Button>
        )}
      </div>
      {open && results.length > 0 && (
        <div ref={listRef} className="absolute left-0 top-9 z-40 max-h-80 w-80 overflow-y-auto sm:left-auto sm:right-0 rounded-xl border border-mirai-border bg-card p-1 shadow-soft">
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
        <div className="absolute left-0 top-9 z-40 max-h-[calc(100vh-var(--app-header-h)-5rem)] w-[28rem] overflow-y-auto sm:left-auto sm:right-0 rounded-xl border border-mirai-border bg-card p-1 shadow-soft" data-pan-disabled="true">
          {filterFields}
        </div>
      )}
    </div>
  );
}
