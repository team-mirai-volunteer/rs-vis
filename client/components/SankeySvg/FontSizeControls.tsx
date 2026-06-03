'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

// [delta, SVGパス, ラベル]
const ARROW_PATHS: [number, string, string][] = [
  [1, 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '大きく'],
  [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '小さく'],
];

interface FontSizeControlsProps {
  baseFontPx: number;
  setBaseFontPx: Dispatch<SetStateAction<number>>;
  markReplace: () => void;
  isCompactWidth: boolean;
  min: number;
  max: number;
  defaultValue: number;
  /** 数値入力欄のフォントサイズ（基準フォントに連動した値） */
  controlSmallFontPx: number;
  /** 数値表示ボタンのフォントサイズ（基準フォントに連動させない固定値） */
  numberFontPx: number;
}

/** 基準フォントサイズ調整（デスクトップは左下フローティング、スマホ幅では設定ダイアログ内に表示） */
export function FontSizeControls({
  baseFontPx, setBaseFontPx, markReplace, isCompactWidth, min, max, defaultValue, controlSmallFontPx, numberFontPx,
}: FontSizeControlsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(baseFontPx));
  const repeat = useRepeatPress();
  const clampFont = (v: number) => Math.max(min, Math.min(max, v));

  // 外部から baseFontPx が変わったら入力欄表示を同期（localStorage 復元・履歴操作など）
  useEffect(() => { setInputValue(String(baseFontPx)); }, [baseFontPx]);

  const commitInput = () => {
    const v = Number(inputValue);
    if (!Number.isFinite(v)) { setInputValue(String(baseFontPx)); return; }
    const next = clampFont(v);
    setInputValue(String(next));
    if (next !== baseFontPx) { markReplace(); setBaseFontPx(next); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: isCompactWidth ? 4 : 8 }}>
      {/* スマホ幅では設定ダイアログ内でTopNスライダーと左端・幅を揃えるためのスペーサ */}
      {isCompactWidth && <span aria-hidden style={{ width: '3.5em', flexShrink: 0 }} />}
      <input
        type="range" min={min} max={max} step={1}
        value={baseFontPx}
        onChange={e => { markReplace(); setBaseFontPx(Number(e.target.value)); }}
        style={isCompactWidth ? { flex: 1, minWidth: 0, boxSizing: 'border-box', margin: 0 } : { width: 60, boxSizing: 'border-box', margin: 0 }}
        data-pan-disabled
        aria-label="基準フォントサイズ"
      />
      {isEditing ? (
        <input
          type="number" autoFocus min={min} max={max} step={1}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { commitInput(); setIsEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { commitInput(); setIsEditing(false); }
            else if (e.key === 'Escape') { setInputValue(String(baseFontPx)); setIsEditing(false); }
          }}
          style={{ width: `${Math.max(40, String(max).length * 8 + 20)}px`, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: controlSmallFontPx }}
          data-pan-disabled
          aria-label="基準フォントサイズ(数値)"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setInputValue(String(baseFontPx)); setIsEditing(true); }}
          title="クリックしてフォントサイズを入力"
          style={{ color: '#999', fontSize: numberFontPx, background: 'transparent', border: 'none', cursor: 'text', padding: 0, minWidth: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          data-pan-disabled
          aria-label="基準フォントサイズ編集を開始"
        >{baseFontPx}</button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
        {ARROW_PATHS.map(([delta, path, title]) => {
          const step = () => { markReplace(); setBaseFontPx(prev => clampFont(prev + delta)); };
          return (
            <button key={delta} type="button" title={title} aria-label={title}
              {...repeat(step, { stopPropagation: true })}
              onClick={(e) => { if (e.detail === 0) step(); }}
              style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
              data-pan-disabled
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path} /></svg>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => { markReplace(); setBaseFontPx(defaultValue); }}
        title="既定値に戻す"
        aria-label="既定値に戻す"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', color: '#555' }}
        data-pan-disabled
      >
        {/* Material Icons: reset_settings */}
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M520-330v-60h160v60H520Zm60 210v-50h-60v-60h60v-50h60v160h-60Zm100-50v-60h160v60H680Zm40-110v-160h60v50h60v60h-60v50h-60Zm111-280h-83q-26-88-99-144t-169-56q-117 0-198.5 81.5T200-480q0 72 32.5 132t87.5 98v-110h80v240H160v-80h94q-62-50-98-122.5T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q129 0 226.5 79.5T831-560Z" />
        </svg>
      </button>
    </div>
  );
}
