'use client';

/**
 * 表示プリセットのセレクト（年度セレクトと同じ見た目で隣に置く）。
 * 列の個別トグルは表示設定（⋮）の中（UnifiedColumnToggles）に置き、常時見えるのはこの1つだけにする。
 */

import { UNIFIED_COLUMNS, UNIFIED_COLUMN_LABELS, type UnifiedColumn } from '@/types/unified-budget';
import { UNIFIED_PRESET_COLUMNS, UNIFIED_PRESET_LABELS, type UnifiedPreset } from '@/types/unified-budget-view';

/** 表示列の組からプリセット名を逆引きする（一致しなければ custom） */
export function presetOf(visible: UnifiedColumn[]): UnifiedPreset {
  const key = UNIFIED_COLUMNS.filter(c => visible.includes(c)).join(',');
  for (const [preset, cols] of Object.entries(UNIFIED_PRESET_COLUMNS) as Array<[Exclude<UnifiedPreset, 'custom'>, UnifiedColumn[]]>) {
    if (cols.join(',') === key) return preset;
  }
  return 'custom';
}

export function UnifiedViewSelect({
  visibleColumns,
  availableColumns,
  onChange,
}: {
  visibleColumns: UnifiedColumn[];
  availableColumns: UnifiedColumn[];
  onChange: (preset: Exclude<UnifiedPreset, 'custom'>, columns: UnifiedColumn[]) => void;
}) {
  const preset = presetOf(visibleColumns);
  return (
    <div className="relative shrink-0" data-pan-disabled="true">
      <select
        value={preset}
        aria-label="表示プリセット"
        onChange={e => {
          const p = e.target.value as UnifiedPreset;
          if (p === 'custom') return;
          onChange(p, UNIFIED_PRESET_COLUMNS[p].filter(c => availableColumns.includes(c)));
        }}
        className="h-9 cursor-pointer appearance-none rounded-lg border border-black/10 bg-white/90 pl-2.5 pr-7 text-xs text-neutral-700 shadow-md backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      >
        {(Object.keys(UNIFIED_PRESET_LABELS) as UnifiedPreset[]).map(p => (
          <option key={p} value={p} disabled={p === 'custom'}>
            {UNIFIED_PRESET_LABELS[p]}
          </option>
        ))}
      </select>
      <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 fill-neutral-400">
        <path d="M7 10l5 5 5-5z" />
      </svg>
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
    <div className="flex flex-col gap-1 border-t border-gray-100 pt-2">
      <div className="font-medium">表示する列</div>
      <div className="flex flex-wrap gap-1">
        {UNIFIED_COLUMNS.map(col => {
          const available = availableColumns.includes(col);
          const on = visibleColumns.includes(col);
          return (
            <button
              key={col}
              type="button"
              disabled={!available}
              aria-pressed={on}
              title={available ? undefined : 'この年度にはありません'}
              onClick={() => toggle(col)}
              className={`rounded border px-1.5 py-px text-[11px] ${
                !available ? 'cursor-not-allowed border-gray-100 text-gray-300' : on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {UNIFIED_COLUMN_LABELS[col]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
