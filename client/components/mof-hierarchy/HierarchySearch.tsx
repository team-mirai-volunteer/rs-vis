'use client';

/**
 * ノード検索とフィルタの入り口。
 *
 * 6列・数百ノードあると目当ての省庁や事項を目で探せない。
 * `/sankey-svg` と同じく左上に置き、選ぶとそのノードが選択される。
 *
 * フィルタは `/sankey-svg` と同じく独立したポップオーバーにはせず、
 * この検索カードの内側に展開する。開閉はカード外・下部の山形タブで行う
 * （TopN パネルの開閉と同じ構造）。外側クリックでは閉じない
 * （TopN パネルと同じく、押すまで開いたままにする）。
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MOFHierarchyNode } from '@/types/mof-hierarchy';
import { MOF_HIERARCHY_COLUMN_LABELS } from '@/types/mof-hierarchy';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { testId } from '@/client/lib/testId';

/** 候補の上限。多すぎると選べないので絞る */
const MAX_RESULTS = 30;

/** 検索を始める最小文字数。1文字だとほぼ全件が並ぶ */
const MIN_QUERY_LENGTH = 2;

export function HierarchySearch({
  nodes,
  onSelect,
  filterFields,
  filterOpen,
  onToggleFilter,
}: {
  nodes: MOFHierarchyNode[];
  onSelect: (id: string) => void;
  /** フィルタの入力欄。カードの内側、検索欄の下に展開する */
  filterFields: ReactNode;
  filterOpen: boolean;
  onToggleFilter: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  /** 矢印キーで指している候補。-1 は未選択 */
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

  /** 検索語や候補一覧が変わったら、指している候補も無効になるので戻す */
  const resetCursor = (next: string) => {
    setQuery(next);
    setOpen(true);
    setCursor(-1);
  };

  /** 選択して一覧を閉じる。マウスとキーボードの両方から呼ぶ */
  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div
      className="relative w-72"
      data-pan-disabled="true"
      // 検索結果一覧だけを閉じる。フィルタの開閉はここでは触らない。
      // 一覧は絶対配置でこの外枠の子（カードの兄弟）なので、ここに付けないと
      // Tab で入力欄から候補へ移った瞬間に一覧側へフォーカスが渡る前に閉じてしまう
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="flex flex-col">
        {/* カード。検索欄とフィルタ本文を同じ枠の中に収める（/sankey-svg と同じ） */}
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
          {filterOpen && (
            <div className="border-t border-border">{filterFields}</div>
          )}
        </div>

        {/* 開閉タブ（カード外・下部 — TopN パネルの開閉と同じ構造） */}
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
              data-testid={testId('hierarchy-search-result')}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={e => {
                // blur より先に拾う。blur が走ると一覧が閉じてクリックが届かない
                e.preventDefault();
                choose(node.id);
              }}
              // キーボード操作では onMouseDown が発火しないので、こちらでも拾う
              onClick={() => choose(node.id)}
              className={cn(
                'block h-auto w-full whitespace-normal rounded-none px-3 py-1.5 text-left font-normal',
                i === cursor ? 'bg-primary/10 hover:bg-primary/10' : 'hover:bg-mirai-surface'
              )}
            >
              <div className="text-[10px] text-mirai-text-muted">
                {MOF_HIERARCHY_COLUMN_LABELS[node.details.column]}
              </div>
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
