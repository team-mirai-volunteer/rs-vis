'use client';

import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

const TOP_MIN = 1;
const TOP_MAX = 300;
const clampTop = (v: number) => Math.max(TOP_MIN, Math.min(TOP_MAX, v));

// つまみの最小幅(px)。総件数が多いと topN/total が極小になるため掴めなくなるのを防ぐ
const THUMB_MIN_PX = 14;

// [delta, アイコン, ラベル]
const ARROWS: [number, typeof ChevronUp, string][] = [
  [1, ChevronUp, '増やす'],
  [-1, ChevronDown, '減らす'],
];

/** 上下矢印（長押し対応）の共通クラス。縦2段で並べるため高さは親に合わせる */
const STEP_BUTTON_CLASS =
  'h-auto w-4 flex-1 select-none touch-none rounded-none p-0 text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text';

export interface RangeWindowRowProps {
  label: string;
  /** フィルタ後の総件数 */
  total: number;
  /** 表示件数（窓の大きさ）。つまみの長さに反映され、上下矢印・直接入力で調整する */
  topN: number;
  setTopN: Dispatch<SetStateAction<number>>;
  /** 表示開始オフセット（クランプ済み）。つまみの位置 */
  offset: number;
  maxOffset: number;
  /** ページ側で pendingHistoryAction / pendingFocusId の処理を行う */
  onOffsetChange: (v: number) => void;
  markReplace: () => void;
  metaFontPx: number;
}

/**
 * 「表示範囲」1行 = スクロールバー型スライダー + 範囲表示 + 件数（上下矢印つき）。
 * つまみの長さが表示件数（topN/total）、位置が表示開始オフセットに対応する。
 * ネイティブ input[type=range] はつまみ長を変えられないため自前で描画する。
 */
export function RangeWindowRow({
  label, total, topN, setTopN, offset, maxOffset, onOffsetChange, markReplace, metaFontPx,
}: RangeWindowRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const repeat = useRepeatPress();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number } | null>(null);
  const rangeStart = offset + 1;
  const rangeEnd = Math.min(offset + topN, total);
  const commitTop = (v: number) => { markReplace(); setTopN(clampTop(v)); };
  const clampOffset = (v: number) => Math.max(0, Math.min(maxOffset, Math.round(v)));

  // つまみ長 = topN/total（最小 THUMB_MIN_PX）。位置は「トラック残り幅 × offset/maxOffset」のスクロールバー式
  const thumbWidthCss = `max(${total > 0 ? (Math.min(topN, total) / total) * 100 : 100}%, ${THUMB_MIN_PX}px)`;
  const posRatio = maxOffset > 0 ? offset / maxOffset : 0;

  /** ドラッグ量(px) → オフセット量。スクロールバーと同じく「残り幅」を基準にする */
  const dxToOffset = (dx: number) => {
    const track = trackRef.current;
    if (!track || maxOffset <= 0) return 0;
    const trackW = track.getBoundingClientRect().width;
    const thumbW = Math.max((Math.min(topN, total) / Math.max(total, 1)) * trackW, THUMB_MIN_PX);
    const freeW = Math.max(trackW - thumbW, 1);
    return (dx / freeW) * maxOffset;
  };

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startOffset: offset };
  };
  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    onOffsetChange(clampOffset(drag.startOffset + dxToOffset(e.clientX - drag.startX)));
  };
  const onThumbPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  /** トラックの素の部分をクリック: クリック位置がつまみの中心になるようにジャンプ */
  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || maxOffset <= 0) return;
    e.preventDefault();
    const rect = track.getBoundingClientRect();
    const thumbW = Math.max((Math.min(topN, total) / Math.max(total, 1)) * rect.width, THUMB_MIN_PX);
    const freeW = Math.max(rect.width - thumbW, 1);
    const next = clampOffset(((e.clientX - rect.left - thumbW / 2) / freeW) * maxOffset);
    onOffsetChange(next);
    // そのままドラッグへ移行できるようにする
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startOffset: next };
  };

  const onSliderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clampOffset(offset + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clampOffset(offset - 1);
    else if (e.key === 'PageUp') next = clampOffset(offset + topN);
    else if (e.key === 'PageDown') next = clampOffset(offset - topN);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = maxOffset;
    if (next !== null) { e.preventDefault(); e.stopPropagation(); onOffsetChange(next); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span className="text-mirai-text-subtle" style={{ fontSize: metaFontPx, whiteSpace: 'nowrap', width: '3.5em', flexShrink: 0 }}>{label}</span>
      {/* スクロールバー型スライダー。範囲テキストはバー上に重ねて余白を作らない */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label}の表示開始位置`}
        aria-valuemin={0}
        aria-valuemax={maxOffset}
        aria-valuenow={offset}
        aria-valuetext={`${rangeStart}〜${rangeEnd} / ${total}件`}
        onKeyDown={onSliderKeyDown}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerEnd}
        onPointerCancel={onThumbPointerEnd}
        className="relative h-4 min-w-0 flex-1 cursor-pointer touch-none rounded-full bg-mirai-surface-light ring-1 ring-inset ring-black/5"
      >
        <div
          onPointerDown={onThumbPointerDown}
          className="absolute cursor-grab rounded-full bg-mirai-surface-teal ring-1 ring-inset ring-primary"
          style={{
            top: 1, bottom: 1,
            left: `calc((100% - ${thumbWidthCss}) * ${posRatio})`,
            width: thumbWidthCss,
          }}
        />
        {/* 範囲テキストはバー内・右揃え。テキスト長が変わってもバー長が固定で保たれる */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end whitespace-nowrap pr-2 tabular-nums text-mirai-text-subtle" style={{ fontSize: metaFontPx }}>
          {rangeStart}〜{rangeEnd}<span className="text-mirai-text-muted">/{total}件</span>
        </div>
      </div>
      {isEditing ? (
        <input type="number" autoFocus min={TOP_MIN} max={TOP_MAX} step={1}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { const v = Number(inputValue); if (!isNaN(v) && v >= 1) commitTop(v); setIsEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
          className="rounded-md border border-mirai-border bg-card text-center text-mirai-text focus-visible:border-primary"
          style={{ width: 36, fontSize: metaFontPx }}
        />
      ) : (
        <Button variant="ghost" onClick={() => { setInputValue(String(topN)); setIsEditing(true); }} title="クリックして件数を直接入力"
          aria-label={`${label}の表示件数`}
          className="h-auto min-w-6 cursor-text rounded-none p-0 text-right font-normal tabular-nums text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text"
          style={{ fontSize: metaFontPx }}
        >{topN}</Button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
        {ARROWS.map(([delta, Icon, title]) => {
          // 押し続けの回数で刻みを大きくする（1 回の更新に図の再計算が伴い、間隔では加速できないため）
          // 更新は 1 秒に 4 回程度なので、1 秒ごとに段を上げる（1 → 2 → 5 → 10 → 20）
          const magnitude = (tick: number) => (tick < 4 ? 1 : tick < 8 ? 2 : tick < 12 ? 5 : tick < 18 ? 10 : 20);
          const step = (tick = 0) => { markReplace(); setTopN(prev => clampTop(prev + delta * magnitude(tick))); };
          return (
            <Button key={delta} variant="ghost" title={`件数を${title}`} aria-label={`${label}の件数を${title}`}
              {...repeat(step)}
              onClick={(e) => { if (e.detail === 0) step(0); }}
              className={STEP_BUTTON_CLASS}
              style={{ WebkitTouchCallout: 'none' }}
            >
              <Icon className="size-2.5" aria-hidden="true" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
