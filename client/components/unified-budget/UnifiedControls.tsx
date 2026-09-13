'use client';

/**
 * 統合ビューのコントロールパネル: プリセット・列の表示切替・TopN・表示位置。
 * `/mof-sankey` の Controls を、列が可変（畳み込み）な統合ビュー向けに作り直したもの。
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { TopNSliderRow } from '@/client/components/SankeySvg/TopNSliders';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';
import { UNIFIED_COLUMNS, UNIFIED_COLUMN_LABELS, type UnifiedColumn } from '@/types/unified-budget';
import {
  DEFAULT_UNIFIED_TOP_N,
  UNIFIED_PRESET_COLUMNS,
  UNIFIED_PRESET_LABELS,
  type UnifiedOffset,
  type UnifiedPreset,
  type UnifiedTopN,
} from '@/types/unified-budget-view';

const TOP_N_MAX = 300;

const ARROW_PATHS: [number, string, string][] = [
  [-1, 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z', '前へ'],
  [1, 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z', '次へ'],
];

const SELECT_CLASS =
  'h-[19px] cursor-pointer rounded border border-gray-300 bg-white px-1 text-[11px] text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** 表示列の組からプリセット名を逆引きする（一致しなければ custom） */
export function presetOf(visible: UnifiedColumn[]): UnifiedPreset {
  const key = visible.join(',');
  for (const [preset, cols] of Object.entries(UNIFIED_PRESET_COLUMNS) as Array<[Exclude<UnifiedPreset, 'custom'>, UnifiedColumn[]]>) {
    if (cols.join(',') === key) return preset;
  }
  return 'custom';
}

export function UnifiedControls({
  visibleColumns,
  onVisibleColumnsChange,
  onPresetChange,
  availableColumns,
  topN,
  offset,
  columnCounts,
  onTopNChange,
  onOffsetChange,
}: {
  visibleColumns: UnifiedColumn[];
  onVisibleColumnsChange: (next: UnifiedColumn[]) => void;
  /** プリセットを選んだとき（列の変更に加えて、プリセット固有の絞り込み既定を適用するために呼ぶ） */
  onPresetChange?: (preset: Exclude<UnifiedPreset, 'custom'>) => void;
  /** この年度のデータに存在する列（支出の無い年度は事業(支出)・支出先が無い） */
  availableColumns: UnifiedColumn[];
  topN: UnifiedTopN;
  offset: UnifiedOffset;
  columnCounts: Partial<Record<UnifiedColumn, number>>;
  onTopNChange: (next: UnifiedTopN) => void;
  onOffsetChange: (next: UnifiedOffset) => void;
}) {
  const [open, setOpen] = useState(true);
  const rankable = visibleColumns.filter(c => (DEFAULT_UNIFIED_TOP_N[c] ?? 0) > 0 && c !== 'program-spending');
  const [target, setTarget] = useState<UnifiedColumn>(rankable.includes('section') ? 'section' : (rankable[0] ?? 'program'));
  const effectiveTarget = rankable.includes(target) ? target : (rankable[0] ?? 'program');
  const [isEditing, setIsEditing] = useState(false);
  const [input, setInput] = useState('');
  const repeat = useRepeatPress();

  const limitOf = (column: UnifiedColumn) => topN[column] ?? DEFAULT_UNIFIED_TOP_N[column] ?? 0;

  const targetLabel = UNIFIED_COLUMN_LABELS[effectiveTarget];
  const limit = limitOf(effectiveTarget);
  const total = columnCounts[effectiveTarget] ?? 0;
  const max = Math.max(0, total - limit);
  const current = Math.min(offset[effectiveTarget] ?? 0, max);
  const rangeStart = total === 0 ? 0 : current + 1;
  const rangeEnd = limit > 0 ? Math.min(current + limit, total) : total;
  const commitOffset = (next: number) => onOffsetChange({ ...offset, [effectiveTarget]: Math.max(0, Math.min(max, next)) });

  const latest = useRef({ offset, target: effectiveTarget, max, current });
  useLayoutEffect(() => {
    latest.current = { offset, target: effectiveTarget, max, current };
  });
  const stepBy = (delta: number) => {
    const now = latest.current;
    const next = Math.max(0, Math.min(now.max, now.current + delta));
    onOffsetChange({ ...now.offset, [now.target]: next });
  };

  const preset = presetOf(visibleColumns);
  const toggleColumn = (col: UnifiedColumn) => {
    const next = visibleColumns.includes(col) ? visibleColumns.filter(c => c !== col) : UNIFIED_COLUMNS.filter(c => c === col || visibleColumns.includes(c));
    if (next.length === 0) return;
    onVisibleColumnsChange(next);
  };

  return (
    <div className="flex flex-col items-end" data-pan-disabled="true">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-t-md rounded-bl-md border border-gray-200 bg-white/95 px-2.5 py-[5px] text-xs backdrop-blur">
        <div className="col-span-2 flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-gray-500">表示</span>
          <select
            aria-label="プリセット"
            value={preset}
            onChange={e => {
              const p = e.target.value as UnifiedPreset;
              if (p === 'custom') return;
              onVisibleColumnsChange(UNIFIED_PRESET_COLUMNS[p].filter(c => availableColumns.includes(c)));
              onPresetChange?.(p);
            }}
            className={SELECT_CLASS}
          >
            {(Object.keys(UNIFIED_PRESET_LABELS) as UnifiedPreset[]).map(p => (
              <option key={p} value={p} disabled={p === 'custom'}>
                {UNIFIED_PRESET_LABELS[p]}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1">
            {UNIFIED_COLUMNS.map(col => {
              const available = availableColumns.includes(col);
              const on = visibleColumns.includes(col);
              return (
                <button
                  key={col}
                  type="button"
                  disabled={!available}
                  aria-pressed={on}
                  title={available ? `${UNIFIED_COLUMN_LABELS[col]}列を${on ? '隠す' : '表示'}` : `${UNIFIED_COLUMN_LABELS[col]}列はこの年度にありません`}
                  onClick={() => toggleColumn(col)}
                  className={`rounded border px-1.5 py-px text-[10px] ${
                    !available
                      ? 'cursor-not-allowed border-gray-100 text-gray-300'
                      : on
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {UNIFIED_COLUMN_LABELS[col]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-1.5">
          <select aria-label="表示位置の対象" value={effectiveTarget} onChange={e => setTarget(e.target.value as UnifiedColumn)} className={SELECT_CLASS}>
            {rankable.map(column => (
              <option key={column} value={column}>
                {UNIFIED_COLUMN_LABELS[column]}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-[11px] text-gray-500">Top</span>
          {isEditing ? (
            <input
              type="number"
              autoFocus
              min={1}
              max={max + 1}
              step={1}
              aria-label={`${targetLabel}の開始位置(数値)`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onBlur={() => {
                const value = Number(input);
                if (!Number.isNaN(value) && value >= 1) commitOffset(value - 1);
                setIsEditing(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                  return;
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setIsEditing(false);
                }
              }}
              className="w-10 rounded border border-gray-300 text-center text-[11px]"
            />
          ) : (
            <button
              type="button"
              title="クリックして開始位置を入力"
              aria-label={`${targetLabel}の開始位置を直接入力`}
              onClick={() => {
                setInput(String(rangeStart));
                setIsEditing(true);
              }}
              className="cursor-text text-[11px] tabular-nums text-gray-500"
            >
              {rangeStart.toLocaleString()}
            </button>
          )}
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">〜{rangeEnd.toLocaleString()}</span>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            disabled={max === 0}
            aria-label={`${targetLabel}の開始位置`}
            value={current}
            onChange={e => commitOffset(Number(e.target.value))}
            className="w-[60px] min-w-0"
          />
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">/{total.toLocaleString()}件</span>
          <div className="flex shrink-0 items-center gap-0.5">
            {ARROW_PATHS.map(([delta, path, title]) => {
              const step = () => stepBy(delta);
              return (
                <button
                  key={delta}
                  type="button"
                  title={title}
                  aria-label={`${targetLabel}の表示位置を${title}`}
                  {...repeat(step)}
                  onClick={e => {
                    if (e.detail === 0) step();
                  }}
                  className="flex items-center justify-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#555">
                    <path d={path} />
                  </svg>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            title="先頭へリセット"
            aria-label={`${targetLabel}の表示位置を先頭へリセット`}
            onClick={() => commitOffset(0)}
            className="flex shrink-0 items-center justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#555" style={{ transform: 'rotate(-90deg)' }}>
              <path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z" />
            </svg>
          </button>
        </div>

        {open &&
          visibleColumns
            .filter(c => (DEFAULT_UNIFIED_TOP_N[c] ?? 0) > 0)
            .map(column => {
              const label = UNIFIED_COLUMN_LABELS[column];
              const value = limitOf(column);
              const setValue: Dispatch<SetStateAction<number>> = next =>
                onTopNChange({ ...topN, [column]: typeof next === 'function' ? next(value) : next });
              return (
                <TopNSliderRow
                  key={column}
                  label={label}
                  inputLabel={`${label}の表示数`}
                  value={value}
                  setValue={setValue}
                  markReplace={() => {}}
                  metaFontPx={11}
                  max={TOP_N_MAX}
                />
              );
            })}
      </div>

      <button
        type="button"
        title={open ? '表示数 を隠す' : '表示数 を表示'}
        aria-label={open ? '表示数 を隠す' : '表示数 を表示'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="-mt-px flex items-center justify-center rounded-b border border-t-0 border-gray-200 bg-white/95 px-1 backdrop-blur"
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
          <path d={open ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'} />
        </svg>
      </button>
    </div>
  );
}
