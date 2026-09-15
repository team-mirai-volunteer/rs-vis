'use client';

/**
 * TopN と表示位置のパネル。
 *
 * /sankey-svg の TopN／オフセットパネルと同じ作りにしてある。
 * 探索しながら何度も動かす操作なので、ダイアログに畳まず右上に常時出し、
 * 邪魔なときだけパネル外のトグルで隠せるようにする。
 *
 * レイアウトは /sankey-svg のパネル div と同じ「1fr 1fr の CSS Grid」を
 * そのまま使う。1行目（表示位置）は2列にまたがせ、2行目以降の表示数
 * スライダーは列の1マスずつに自然に流し込む（内側に別のグリッドを
 * 入れ子にしない）。
 *
 * 表示位置は対象を1列だけ選んで動かす（/sankey-svg の「事業／支出先」と同じ）。
 * 列ごとに行を並べるとパネルが縦に伸びて図を覆うため。
 * 前へ／次へは /sankey-svg と同じく1件ずつ送る（ページ単位ではない）。
 * 大きく移動したいときは開始位置を直接入力する。
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowUpToLine, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TopNSliderRow } from '@/client/components/SankeySvg/TopNSliders';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';
import {
  MOF_HIERARCHY_COLUMNS,
  MOF_HIERARCHY_COLUMN_LABELS,
  type MOFHierarchyColumn,
  type MOFHierarchyOffset,
  type MOFHierarchyTopN,
} from '@/types/mof-hierarchy';
import { DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';

/** TopN スライダーの上限。/sankey-svg と同じ */
const TOP_N_MAX = 300;

type RankableColumn = Exclude<MOFHierarchyColumn, 'total'>;

/**
 * 表示位置（オフセット）を動かせる対象列。
 *
 * 所管・組織・勘定は候補件数が少なく（実測: 所管25・組織114・勘定33）、
 * 位置をずらす操作自体があまり意味を持たない。項・事項だけに絞る。
 */
const OFFSET_COLUMNS: readonly RankableColumn[] = MOF_HIERARCHY_COLUMNS.filter(
  (c): c is RankableColumn => c === 'section' || c === 'item'
);

/**
 * 表示数（TopN）を設定できる列。
 *
 * 根（予算合計）は1件しかないので対象外。所管・勘定は候補件数が少なく
 * （実測: 所管25・勘定33）、どの年度でも上限を掛けても何も起きないため対象外。
 */
const TOP_N_COLUMNS: readonly RankableColumn[] = MOF_HIERARCHY_COLUMNS.filter(
  (c): c is RankableColumn => c === 'organization' || c === 'section' || c === 'item'
);

// [delta, アイコン, ラベル]
const ARROWS: [number, typeof ChevronLeft, string][] = [
  [-1, ChevronLeft, '前へ'],
  [1, ChevronRight, '次へ'],
];

const SELECT_CLASS =
  'h-[19px] cursor-pointer rounded border border-mirai-border bg-card px-1 text-[11px] text-mirai-text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export function HierarchyControls({
  topN,
  offset,
  columnCounts,
  onTopNChange,
  onOffsetChange,
}: {
  topN: MOFHierarchyTopN;
  /** 列ごとの表示開始位置 */
  offset: MOFHierarchyOffset;
  /** 列ごとの候補件数。表示位置の上限を出すのに使う */
  columnCounts: Partial<Record<MOFHierarchyColumn, number>>;
  onTopNChange: (next: MOFHierarchyTopN) => void;
  onOffsetChange: (next: MOFHierarchyOffset) => void;
}) {
  const [open, setOpen] = useState(true);
  /** 表示位置を動かす対象の列 */
  const [target, setTarget] = useState<RankableColumn>('item');
  const [isEditing, setIsEditing] = useState(false);
  const [input, setInput] = useState('');
  const repeat = useRepeatPress();

  /** その列の窓幅。上限を掛けていない列は候補件数そのもの */
  const limitOf = (column: RankableColumn) =>
    topN[column] ?? DEFAULT_TOP_N[column] ?? columnCounts[column] ?? 0;

  const targetLabel = MOF_HIERARCHY_COLUMN_LABELS[target];
  const limit = limitOf(target);
  const total = columnCounts[target] ?? 0;
  const max = Math.max(0, total - limit);
  const current = Math.min(offset[target] ?? 0, max);
  const rangeStart = total === 0 ? 0 : current + 1;
  const rangeEnd = Math.min(current + limit, total);
  const commitOffset = (next: number) =>
    onOffsetChange({ ...offset, [target]: Math.max(0, Math.min(max, next)) });

  /**
   * 長押しで送るための最新値。
   *
   * useRepeatPress は pointerdown 時点の関数を setInterval で呼び直すので、
   * その関数が当時の開始位置を握っていると、押し続けても同じ位置を
   * 何度も指定するだけで先へ進まない。毎描画で更新する ref から読む。
   */
  const latest = useRef({ offset, target, max, current });
  useLayoutEffect(() => {
    latest.current = { offset, target, max, current };
  });
  /** /sankey-svg の前へ/次へと同じく1件だけ送る */
  const stepBy = (delta: number) => {
    const now = latest.current;
    const next = Math.max(0, Math.min(now.max, now.current + delta));
    onOffsetChange({ ...now.offset, [now.target]: next });
  };

  return (
    <div className="flex flex-col items-end" data-pan-disabled="true">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-t-md rounded-bl-md border border-border bg-card px-2.5 py-[5px] text-xs">
        {/* 1行目: 表示位置。対象を1列選んで窓をずらす（2列にまたがる） */}
        <div className="col-span-2 flex items-center gap-1.5">
          <select
            aria-label="表示位置の対象"
            value={target}
            onChange={e => setTarget(e.target.value as RankableColumn)}
            className={SELECT_CLASS}
          >
            {OFFSET_COLUMNS.map(column => (
              <option key={column} value={column}>
                {MOF_HIERARCHY_COLUMN_LABELS[column]}
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
          <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">
            〜{rangeEnd.toLocaleString()}
          </span>
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
          <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">
            /{total.toLocaleString()}件
          </span>
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
          {/* オフセットリセット */}
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

        {/* 2行目以降: 列ごとの表示数。/sankey-svg と同じく外側の grid に
            直接流し込む（内側に別のグリッドを入れ子にしない） */}
        {open &&
          TOP_N_COLUMNS.map(column => {
            const label = MOF_HIERARCHY_COLUMN_LABELS[column];
            const value = limitOf(column);
            // 増減ボタンは更新関数の形で呼ぶので、それを受けられるようにする
            const setValue: Dispatch<SetStateAction<number>> = next =>
              onTopNChange({
                ...topN,
                [column]: typeof next === 'function' ? next(value) : next,
              });
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

      {/* トグル（パネル外・下部）。/sankey-svg の TopN パネルと同じ作法 */}
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
