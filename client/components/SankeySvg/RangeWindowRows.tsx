'use client';

import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

const TOP_MIN = 1;
const TOP_MAX = 300;
const clampTop = (v: number) => Math.max(TOP_MIN, Math.min(TOP_MAX, v));

// つまみの最小幅(px)。総件数が多いと topN/total が極小になるため掴めなくなるのを防ぐ
const THUMB_MIN_PX = 14;

// [delta, SVGパス, ラベル]
const ARROW_PATHS: [number, string, string][] = [
  [1, 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '増やす'],
  [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '減らす'],
];

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
      <span style={{ color: '#555', fontSize: metaFontPx, whiteSpace: 'nowrap', width: '3.5em', flexShrink: 0 }}>{label}</span>
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
        style={{ position: 'relative', flex: 1, minWidth: 0, height: 16, borderRadius: 8, background: '#ececec', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)', cursor: 'pointer', touchAction: 'none' }}
      >
        <div
          onPointerDown={onThumbPointerDown}
          style={{
            position: 'absolute', top: 1, bottom: 1,
            left: `calc((100% - ${thumbWidthCss}) * ${posRatio})`,
            width: thumbWidthCss,
            borderRadius: 7, background: '#a8c7fa', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
            cursor: 'grab',
          }}
        />
        {/* 範囲テキストはバー内・右揃え。テキスト長が変わってもバー長が固定で保たれる */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, pointerEvents: 'none', fontSize: metaFontPx, color: '#666', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {rangeStart}〜{rangeEnd}<span style={{ color: '#999' }}>/{total}件</span>
        </div>
      </div>
      {isEditing ? (
        <input type="number" autoFocus min={TOP_MIN} max={TOP_MAX} step={1}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { const v = Number(inputValue); if (!isNaN(v) && v >= 1) commitTop(v); setIsEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
          style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: metaFontPx }}
        />
      ) : (
        <button onClick={() => { setInputValue(String(topN)); setIsEditing(true); }} title="クリックして件数を直接入力"
          aria-label={`${label}の表示件数`}
          style={{ color: '#555', fontSize: metaFontPx, background: 'transparent', border: 'none', cursor: 'text', padding: 0, minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
        >{topN}</button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
        {ARROW_PATHS.map(([delta, path, title]) => {
          const step = () => { markReplace(); setTopN(prev => clampTop(prev + delta)); };
          return (
            <button key={delta} title={`件数を${title}`} aria-label={`${label}の件数を${title}`}
              {...repeat(step)}
              onClick={(e) => { if (e.detail === 0) step(); }}
              style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="10" width="10" viewBox="0 0 24 24" fill="#555"><path d={path} /></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
