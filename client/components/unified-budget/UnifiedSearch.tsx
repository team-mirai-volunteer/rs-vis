'use client';

/**
 * ノード検索とフィルタの入り口。`/mof-sankey` の SankeyChartSearch を統合ビューの型に合わせたもの。
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { UNIFIED_COLUMN_LABELS } from '@/types/unified-budget';
import type { UnifiedViewNode } from '@/types/unified-budget-view';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

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
      <div className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/90 px-2 shadow-md backdrop-blur">
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#9ca3af" aria-hidden="true">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
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
          className="h-8 w-56 bg-transparent text-xs text-gray-700 focus:outline-none"
        />
        <button
          type="button"
          title={filterOpen ? '絞り込みを閉じる' : '絞り込みを開く'}
          aria-label={filterOpen ? '絞り込みを閉じる' : '絞り込みを開く'}
          aria-expanded={filterOpen}
          onClick={onToggleFilter}
          className={`rounded px-1 text-xs ${filterOpen ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          絞込
        </button>
      </div>
      {open && results.length > 0 && (
        <div ref={listRef} className="absolute left-0 top-9 z-40 max-h-80 w-80 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
          {results.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(n.id)}
              className={`flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-gray-50 ${i === cursor ? 'bg-gray-100' : ''}`}
            >
              <span className="min-w-0 truncate text-gray-700">
                <span className="mr-1 text-[10px] text-gray-400">{UNIFIED_COLUMN_LABELS[n.details.column]}</span>
                {n.name}
              </span>
              <span className="shrink-0 tabular-nums text-gray-500">{formatBudgetFromYen(n.value)}</span>
            </button>
          ))}
        </div>
      )}
      {filterOpen && (
        <div className="absolute left-0 top-9 z-40 w-96 rounded border border-gray-200 bg-white shadow-lg" data-pan-disabled="true">
          {filterFields}
        </div>
      )}
    </div>
  );
}
