'use client';

/**
 * 統合ビューの表示範囲パネル。`/sankey-svg` と同じ「列ごとに1行の RangeWindowRow」だけの構成。
 * （つまみの長さ＝表示件数、位置＝表示開始。件数は右の数字と上下矢印で変える）
 * プリセットと列の表示切替は UnifiedViewSelect（年度セレクトの隣）と表示設定（⋮）に置き、ここには入れない。
 */

import type { Dispatch, SetStateAction } from 'react';
import { RangeWindowRow } from '@/client/components/SankeySvg/RangeWindowRows';
import { UNIFIED_COLUMNS, UNIFIED_COLUMN_LABELS, type UnifiedColumn } from '@/types/unified-budget';
import { DEFAULT_UNIFIED_TOP_N, type UnifiedOffset, type UnifiedTopN } from '@/types/unified-budget-view';

/** 表示範囲を持つ列。事業(支出) は事業と同じ事業集合に揃えるので行を出さない */
const isRankable = (c: UnifiedColumn) => (DEFAULT_UNIFIED_TOP_N[c] ?? 0) > 0 && c !== 'program-spending';

export function UnifiedControls({
  visibleColumns,
  topN,
  offset,
  columnCounts,
  onTopNChange,
  onOffsetChange,
}: {
  visibleColumns: UnifiedColumn[];
  topN: UnifiedTopN;
  offset: UnifiedOffset;
  columnCounts: Partial<Record<UnifiedColumn, number>>;
  onTopNChange: (next: UnifiedTopN) => void;
  onOffsetChange: (next: UnifiedOffset) => void;
}) {
  const rows = UNIFIED_COLUMNS.filter(c => visibleColumns.includes(c) && isRankable(c));
  if (rows.length === 0) return null;
  return (
    <div data-pan-disabled="true" className="flex flex-col gap-1 rounded-xl border border-mirai-border bg-card px-3 py-1.5 shadow-xs" style={{ width: 300 }}>
      {rows.map(column => {
        const total = columnCounts[column] ?? 0;
        const limit = topN[column] ?? DEFAULT_UNIFIED_TOP_N[column];
        const maxOffset = Math.max(0, total - limit);
        const current = Math.min(offset[column] ?? 0, maxOffset);
        const setTopN: Dispatch<SetStateAction<number>> = next => {
          const value = typeof next === 'function' ? next(limit) : next;
          // 事業(支出) は事業と同じ件数に揃える
          const patch: UnifiedTopN = { ...topN, [column]: value };
          if (column === 'program') patch['program-spending'] = value;
          onTopNChange(patch);
        };
        return (
          <RangeWindowRow
            key={column}
            label={UNIFIED_COLUMN_LABELS[column]}
            total={total}
            topN={limit}
            setTopN={setTopN}
            offset={current}
            maxOffset={maxOffset}
            onOffsetChange={v => onOffsetChange({ ...offset, [column]: v })}
            markReplace={() => {}}
            metaFontPx={12}
          />
        );
      })}
    </div>
  );
}
