'use client';

/**
 * ノード検索とフィルタの入り口。`/mof-hierarchy` の HierarchySearch と同じ作り。
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MOFSectionRsNode } from '@/types/mof-section-rs-sankey';
import { MOF_SECTION_RS_COLUMN_LABELS } from '@/types/mof-section-rs-sankey';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { testId } from '@/client/lib/testId';

const MAX_RESULTS = 30;
const MIN_QUERY_LENGTH = 2;

export function SankeyChartSearch({
  nodes,
  onSelect,
  filterFields,
  filterOpen,
  onToggleFilter,
}: {
  nodes: MOFSectionRsNode[];
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
      .filter(n => !n.details.passThrough && n.name.includes(q))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, MAX_RESULTS);
  }, [nodes, query]);

  const resetCursor = (next: string) => {
    setQuery(next);
    setOpen(true);
    setCursor(-1);
  };

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div
      className="relative w-72"
      data-pan-disabled="true"
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="flex flex-col">
        <div
          className="rounded-t-lg rounded-bl-lg border border-mirai-border bg-card shadow-xs"
          onMouseDown={e => e.stopPropagation()}
        >
          <input
            type="search"
            value={query}
            placeholder={`検索（${MIN_QUERY_LENGTH}文字以上）`}
            onChange={e => resetCursor(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={e => {
              if (results.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor(i => {
                  const next = Math.min(i + 1, results.length - 1);
                  listRef.current?.children[next + 1]?.scrollIntoView({ block: 'nearest' });
                  return next;
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor(i => {
                  const next = Math.max(i - 1, -1);
                  listRef.current?.children[next + 1]?.scrollIntoView({ block: 'nearest' });
                  return next;
                });
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (cursor >= 0 && cursor < results.length) choose(results[cursor].id);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="h-9 w-full rounded-t-lg bg-transparent px-3 text-xs text-mirai-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {filterOpen && <div className="border-t border-border">{filterFields}</div>}
        </div>

        <Button
          variant="ghost"
          title={filterOpen ? 'フィルタ を隠す' : 'フィルタ を表示'}
          aria-label={filterOpen ? 'フィルタ を隠す' : 'フィルタ を表示'}
          aria-expanded={filterOpen}
          onMouseDown={e => e.stopPropagation()}
          onClick={onToggleFilter}
          className="-mt-px h-4 w-6 self-end rounded-none rounded-b border border-t-0 border-mirai-border bg-card p-0 text-mirai-text-muted hover:bg-card hover:text-mirai-text-subtle"
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform', filterOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </Button>
      </div>

      {open && results.length > 0 && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-soft"
        >
          <div className="border-b border-border px-3 py-1 text-[11px] text-mirai-text-muted">
            {results.length}件{results.length === MAX_RESULTS ? '（上位のみ）' : ''}
          </div>
          {results.map((node, i) => (
            <Button
              key={node.id}
              variant="ghost"
              data-testid={testId('section-rs-search-result')}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={e => {
                e.preventDefault();
                choose(node.id);
              }}
              onClick={() => choose(node.id)}
              className={cn(
                'block h-auto w-full whitespace-normal rounded-none px-3 py-1.5 text-left font-normal',
                i === cursor ? 'bg-primary/10 hover:bg-primary/10' : 'hover:bg-mirai-surface'
              )}
            >
              <div className="text-[10px] text-mirai-text-muted">{MOF_SECTION_RS_COLUMN_LABELS[node.details.column]}</div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-mirai-text">{node.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">
                  {formatBudgetFromYen(node.value ?? 0)}
                </span>
              </div>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
