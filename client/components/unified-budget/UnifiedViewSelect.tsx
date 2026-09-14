'use client';

/**
 * 表示プリセットのセレクト（年度セレクトと同じ見た目で隣に置く）。
 * 列の個別トグルは表示設定（⋮）の中（UnifiedColumnToggles）に置き、常時見えるのはこの1つだけにする。
 */

import { UNIFIED_COLUMNS, UNIFIED_COLUMN_LABELS, type UnifiedColumn } from '@/types/unified-budget';
import { UNIFIED_PRESET_COLUMNS, UNIFIED_PRESET_LABELS, type UnifiedPreset } from '@/types/unified-budget-view';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 表示列の組からプリセット名を逆引きする。
 * プリセットの列は「その年度で表示できる列」に絞って比べる（2026 は支出先が無い等）。
 * どれにも一致しない列の組（表示設定で個別に切った状態）は「統合」を表示する。
 * 「カスタム」という第 5 の状態は置かない: 実際にはどの組も「その年度で出せる範囲の統合」なので
 */
export function presetOf(visible: UnifiedColumn[], available: UnifiedColumn[] = UNIFIED_COLUMNS as unknown as UnifiedColumn[]): UnifiedPreset {
  const key = UNIFIED_COLUMNS.filter(c => visible.includes(c)).join(',');
  for (const [preset, cols] of Object.entries(UNIFIED_PRESET_COLUMNS) as Array<[UnifiedPreset, UnifiedColumn[]]>) {
    if (cols.filter(c => available.includes(c)).join(',') === key) return preset;
  }
  return 'full';
}

export function UnifiedViewSelect({
  visibleColumns,
  availableColumns,
  onChange,
}: {
  visibleColumns: UnifiedColumn[];
  availableColumns: UnifiedColumn[];
  onChange: (preset: UnifiedPreset, columns: UnifiedColumn[]) => void;
}) {
  const preset = presetOf(visibleColumns, availableColumns);
  return (
    <div className="relative shrink-0" data-pan-disabled="true">
      <select
        value={preset}
        aria-label="表示プリセット"
        onChange={e => {
          const p = e.target.value as UnifiedPreset;
          onChange(p, UNIFIED_PRESET_COLUMNS[p].filter(c => availableColumns.includes(c)));
        }}
        className="h-9 cursor-pointer appearance-none rounded-full border border-mirai-border bg-card pl-3 pr-8 text-xs font-bold text-mirai-text shadow-xs transition-colors hover:bg-mirai-surface focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      >
        {(Object.keys(UNIFIED_PRESET_LABELS) as UnifiedPreset[]).map(p => (
          <option key={p} value={p}>
            {UNIFIED_PRESET_LABELS[p]}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mirai-text-muted" />
    </div>
  );
}

/** 列の表示切替（表示設定の中に置く） */
export function UnifiedColumnToggles({
  visibleColumns,
  availableColumns,
  onChange,
}: {
  visibleColumns: UnifiedColumn[];
  availableColumns: UnifiedColumn[];
  onChange: (columns: UnifiedColumn[]) => void;
}) {
  const toggle = (col: UnifiedColumn) => {
    const next = visibleColumns.includes(col) ? visibleColumns.filter(c => c !== col) : UNIFIED_COLUMNS.filter(c => c === col || visibleColumns.includes(c));
    if (next.length > 0) onChange(next);
  };
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2">
      <div className="font-medium">表示する列</div>
      <div className="flex flex-wrap gap-1">
        {UNIFIED_COLUMNS.map(col => {
          const available = availableColumns.includes(col);
          const on = visibleColumns.includes(col);
          return (
            <Button
              key={col}
              variant="outline"
              size="xs"
              disabled={!available}
              aria-pressed={on}
              title={available ? undefined : 'この年度にはありません'}
              onClick={() => toggle(col)}
              className={cn(
                'h-6 px-2 text-[11px] font-medium',
                on ? 'border-primary bg-mirai-surface-teal text-primary-accent' : 'border-mirai-border text-mirai-text-muted'
              )}
            >
              {UNIFIED_COLUMN_LABELS[col]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
