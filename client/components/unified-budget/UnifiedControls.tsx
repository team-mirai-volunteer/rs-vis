'use client';

/**
 * 統合ビューの表示範囲パネル。`/sankey-svg` と同じ RangeWindowRow を列ごとに 1 つ、横に並べる。
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
  /** 関数形式も受ける（押し続けの連続更新で最新値から計算するため）。ページの setState をそのまま渡す */
  onTopNChange: Dispatch<SetStateAction<UnifiedTopN>>;
  onOffsetChange: (next: UnifiedOffset) => void;
}) {
  const rows = UNIFIED_COLUMNS.filter(c => visibleColumns.includes(c) && isRankable(c));
  if (rows.length === 0) return null;
  return (
    // 列ごとに独立したカードを横に並べる（1 枚 ≒ 260px）。縦に積むと図の上端を圧迫するため。狭幅では折り返す
    <div data-pan-disabled="true" className="flex flex-wrap items-center gap-2">
      {rows.map(column => {
        const total = columnCounts[column] ?? 0;
        const limit = topN[column] ?? DEFAULT_UNIFIED_TOP_N[column];
        const maxOffset = Math.max(0, total - limit);
        const current = Math.min(offset[column] ?? 0, maxOffset);
        // 押し続けで連続更新されるので、描画時の limit ではなく最新の state から計算する
        // （閉包の値を使うと 2 回目以降が同じ値を上書きして 1 だけしか動かない）
        const setTopN: Dispatch<SetStateAction<number>> = next => {
          onTopNChange(prev => {
            const current = prev[column] ?? DEFAULT_UNIFIED_TOP_N[column];
            const value = typeof next === 'function' ? next(current) : next;
            // 事業(支出) は事業と同じ件数に揃える
            const patch: UnifiedTopN = { ...prev, [column]: value };
            if (column === 'program') patch['program-spending'] = value;
            return patch;
          });
        };
        return (
          <div key={column} className="w-[260px] min-w-0 rounded-xl border border-mirai-border bg-card px-3 py-1.5 shadow-xs">
          <RangeWindowRow
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
          </div>
        );
      })}
    </div>
  );
}
