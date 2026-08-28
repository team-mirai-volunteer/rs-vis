'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

const TOP_MIN = 1;
const TOP_MAX = 300;
const clampTop = (v: number) => Math.max(TOP_MIN, Math.min(TOP_MAX, v));

// [delta, SVGパス, ラベル]
const ARROW_PATHS: [number, string, string][] = [
  [1, 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '増やす'],
  [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '減らす'],
];

export interface RangeWindowRowProps {
  label: string;
  /** フィルタ後の総件数 */
  total: number;
  /** 表示件数（窓の大きさ）。上下矢印・直接入力で調整する */
  topN: number;
  setTopN: Dispatch<SetStateAction<number>>;
  /** 表示開始オフセット（クランプ済み）。スライダー＝窓の位置 */
  offset: number;
  maxOffset: number;
  /** ページ側で pendingHistoryAction / pendingFocusId の処理を行う */
  onOffsetChange: (v: number) => void;
  markReplace: () => void;
  metaFontPx: number;
}

/**
 * 「表示範囲」1行 = 窓の位置スライダー + 範囲表示 + 件数（上下矢印つき）。
 * 旧 TopNSliders（件数のみのスライダー）と表示開始位置スライダーを1つのコントロールに統合したもの。
 */
export function RangeWindowRow({
  label, total, topN, setTopN, offset, maxOffset, onOffsetChange, markReplace, metaFontPx,
}: RangeWindowRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const repeat = useRepeatPress();
  const rangeStart = offset + 1;
  const rangeEnd = Math.min(offset + topN, total);
  const commitTop = (v: number) => { markReplace(); setTopN(clampTop(v)); };
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ color: '#555', fontSize: metaFontPx, whiteSpace: 'nowrap', width: '3.5em', flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={0} max={maxOffset} step={1}
        value={offset}
        onChange={e => onOffsetChange(Number(e.target.value))}
        aria-label={`${label}の表示開始位置`}
        style={{ flex: 1, minWidth: 0, width: 0 }}
      />
      <span style={{ color: '#999', fontSize: metaFontPx, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {rangeStart}〜{rangeEnd} <span style={{ color: '#bbb' }}>/{total.toLocaleString()}件</span>
      </span>
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
              <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path} /></svg>
            </button>
          );
        })}
      </div>
    </label>
  );
}
