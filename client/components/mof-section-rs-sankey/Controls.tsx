'use client';

/**
 * TopN と表示位置のパネル。`/mof-hierarchy` の HierarchyControls と同じ作り。
 * 対象列は 組織/特会・項 の2つ（事項列が無いぶん、対象がその2つだけになる）。
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowUpToLine, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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

// [delta, アイコン, ラベル]
const ARROWS: [number, typeof ChevronLeft, string][] = [
  [-1, ChevronLeft, '前へ'],
  [1, ChevronRight, '次へ'],
];

const SELECT_CLASS =
  'h-[19px] cursor-pointer rounded border border-mirai-border bg-card px-1 text-[11px] text-mirai-text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

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
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-t-md rounded-bl-md border border-border bg-card px-2.5 py-[5px] text-xs">
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
          <span className="shrink-0 text-[11px] text-mirai-text-muted">Top</span>
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
              className="w-10 rounded border border-mirai-border text-center text-[11px]"
            />
          ) : (
            <Button
              variant="ghost"
              title="クリックして開始位置を入力"
              aria-label={`${targetLabel}の開始位置を直接入力`}
              onClick={() => {
                setInput(String(rangeStart));
                setIsEditing(true);
              }}
              className="h-auto cursor-text rounded-none p-0 text-[11px] font-normal tabular-nums text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
            >
              {rangeStart.toLocaleString()}
            </Button>
          )}
          <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">〜{rangeEnd.toLocaleString()}</span>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            disabled={max === 0}
            aria-label={`${targetLabel}の開始位置`}
            value={current}
            onChange={e => commitOffset(Number(e.target.value))}
            className="policy-range w-[60px] min-w-0"
          />
          <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">/{total.toLocaleString()}件</span>
          <div className="flex shrink-0 items-center gap-0.5">
            {ARROWS.map(([delta, Icon, title]) => {
              const step = () => stepBy(delta);
              return (
                <Button
                  key={delta}
                  variant="ghost"
                  size="icon-sm"
                  title={title}
                  aria-label={`${targetLabel}の表示位置を${title}`}
                  {...repeat(step)}
                  onClick={e => {
                    if (e.detail === 0) step();
                  }}
                  className="size-5 text-mirai-text-subtle"
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </Button>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title="先頭へリセット"
            aria-label={`${targetLabel}の表示位置を先頭へリセット`}
            onClick={() => commitOffset(0)}
            className="size-5 shrink-0 text-mirai-text-subtle"
          >
            <ArrowUpToLine className="size-3.5 -rotate-90" aria-hidden="true" />
          </Button>
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

      <Button
        variant="ghost"
        title={open ? '表示数 を隠す' : '表示数 を表示'}
        aria-label={open ? '表示数 を隠す' : '表示数 を表示'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="-mt-px h-4 rounded-none rounded-b border border-t-0 border-border bg-card px-1 text-mirai-text-placeholder hover:bg-card hover:text-mirai-text-muted"
      >
        <ChevronDown
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </Button>
    </div>
  );
}
