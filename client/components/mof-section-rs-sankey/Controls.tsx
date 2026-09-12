'use client';

/**
 * TopN と表示位置のパネル。`/mof-hierarchy` の HierarchyControls と同じ作り。
 * 対象列は 組織/特会・項 の2つ（事項列が無いぶん、対象がその2つだけになる）。
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { TopNSliderRow } from '@/client/components/SankeySvg/TopNSliders';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';
import {
  MOF_SECTION_RS_COLUMNS,
  MOF_SECTION_RS_COLUMN_LABELS,
  type MOFSectionRsColumn,
  type MOFSectionRsOffset,
  type MOFSectionRsTopN,
} from '@/types/mof-section-rs-sankey';
import { DEFAULT_TOP_N } from '@/app/lib/mof-section-rs-sankey';

const TOP_N_MAX = 300;

type RankableColumn = Exclude<MOFSectionRsColumn, 'total' | 'rsStatus'>;
type TopNColumn = Exclude<MOFSectionRsColumn, 'total'>;

/** 表示位置（オフセット）を動かせる対象列。RS事業（rsStatus）は項のTopN・オフセットの
    窓に入っている項の紐づけから自動で選ぶので、位置替えは持たない */
const OFFSET_COLUMNS: readonly RankableColumn[] = MOF_SECTION_RS_COLUMNS.filter(
  (c): c is RankableColumn => c === 'organization' || c === 'section'
);

/** 表示数（TopN）を設定できる列。RS事業（rsStatus）も対象に含む */
const TOP_N_COLUMNS: readonly TopNColumn[] = MOF_SECTION_RS_COLUMNS.filter(
  (c): c is TopNColumn => c === 'organization' || c === 'section' || c === 'rsStatus'
);

const ARROW_PATHS: [number, string, string][] = [
  [-1, 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z', '前へ'],
  [1, 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z', '次へ'],
];

const SELECT_CLASS =
  'h-[19px] cursor-pointer rounded border border-gray-300 bg-white px-1 text-[11px] text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function Controls({
  topN,
  offset,
  columnCounts,
  onTopNChange,
  onOffsetChange,
}: {
  topN: MOFSectionRsTopN;
  offset: MOFSectionRsOffset;
  columnCounts: Partial<Record<MOFSectionRsColumn, number>>;
  onTopNChange: (next: MOFSectionRsTopN) => void;
  onOffsetChange: (next: MOFSectionRsOffset) => void;
}) {
  const [open, setOpen] = useState(true);
  const [target, setTarget] = useState<RankableColumn>('section');
  const [isEditing, setIsEditing] = useState(false);
  const [input, setInput] = useState('');
  const repeat = useRepeatPress();

  const limitOf = (column: TopNColumn) => topN[column] ?? DEFAULT_TOP_N[column] ?? columnCounts[column] ?? 0;

  const targetLabel = MOF_SECTION_RS_COLUMN_LABELS[target];
  const limit = limitOf(target);
  const total = columnCounts[target] ?? 0;
  const max = Math.max(0, total - limit);
  const current = Math.min(offset[target] ?? 0, max);
  const rangeStart = total === 0 ? 0 : current + 1;
  const rangeEnd = Math.min(current + limit, total);
  const commitOffset = (next: number) => onOffsetChange({ ...offset, [target]: Math.max(0, Math.min(max, next)) });

  const latest = useRef({ offset, target, max, current });
  useLayoutEffect(() => {
    latest.current = { offset, target, max, current };
  });
  const stepBy = (delta: number) => {
    const now = latest.current;
    const next = Math.max(0, Math.min(now.max, now.current + delta));
    onOffsetChange({ ...now.offset, [now.target]: next });
  };

  return (
    <div className="flex flex-col items-end" data-pan-disabled="true">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-t-md rounded-bl-md border border-gray-200 bg-white/95 px-2.5 py-[5px] text-xs backdrop-blur">
        <div className="col-span-2 flex items-center gap-1.5">
          <select
            aria-label="表示位置の対象"
            value={target}
            onChange={e => setTarget(e.target.value as RankableColumn)}
            className={SELECT_CLASS}
          >
            {OFFSET_COLUMNS.map(column => (
              <option key={column} value={column}>
                {MOF_SECTION_RS_COLUMN_LABELS[column]}
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="14"
              width="14"
              viewBox="0 0 24 24"
              fill="#555"
              style={{ transform: 'rotate(-90deg)' }}
            >
              <path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z" />
            </svg>
          </button>
        </div>

        {open &&
          TOP_N_COLUMNS.map(column => {
            const label = MOF_SECTION_RS_COLUMN_LABELS[column];
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
          <path
            d={
              open
                ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z'
                : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'
            }
          />
        </svg>
      </button>
    </div>
  );
}
