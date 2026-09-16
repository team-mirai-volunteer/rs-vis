'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

// [delta, アイコン, ラベル]
const ARROWS: [number, typeof ChevronUp, string][] = [
  [1, ChevronUp, '大きく'],
  [-1, ChevronDown, '小さく'],
];

/** 上下矢印（長押し対応）の共通クラス。縦2段で並べるため高さは親に合わせる */
const STEP_BUTTON_CLASS =
  'h-auto w-4 flex-1 select-none touch-none rounded-none p-0 text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text';

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
  stepSize?: number;
  label?: string;
  suffix?: string;
}

/** 基準フォントサイズ調整（デスクトップは左下フローティング、スマホ幅では設定ダイアログ内に表示） */
export function FontSizeControls({
  baseFontPx, setBaseFontPx, markReplace, isCompactWidth, min, max, defaultValue, controlSmallFontPx, numberFontPx,
  stepSize = 1, label = '基準フォントサイズ', suffix = '',
}: FontSizeControlsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(baseFontPx));
  const repeat = useRepeatPress();
  const clampFont = (v: number) => Number(Math.max(min, Math.min(max, stepSize === 1 ? v : Math.round(v / stepSize) * stepSize)).toFixed(8));

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
        type="range" min={min} max={max} step={stepSize}
        value={baseFontPx}
        onChange={e => { markReplace(); setBaseFontPx(Number(e.target.value)); }}
        className="policy-range"
        style={isCompactWidth ? { flex: 1, minWidth: 0, boxSizing: 'border-box', margin: 0 } : { width: 60, boxSizing: 'border-box', margin: 0 }}
        data-pan-disabled
        aria-label={label}
      />
      {isEditing ? (
        <input
          type="number" autoFocus min={min} max={max} step={stepSize}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { commitInput(); setIsEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { commitInput(); setIsEditing(false); }
            else if (e.key === 'Escape') { setInputValue(String(baseFontPx)); setIsEditing(false); }
          }}
          className="rounded-md border border-mirai-border bg-card text-center text-mirai-text focus-visible:border-primary"
          style={{ width: `${Math.max(40, String(max).length * 8 + 20)}px`, fontSize: controlSmallFontPx }}
          data-pan-disabled
          aria-label={`${label}(数値)`}
        />
      ) : (
        <Button
          variant="ghost"
          onClick={() => { setInputValue(String(baseFontPx)); setIsEditing(true); }}
          title={`クリックして${label}を入力`}
          className="h-auto min-w-5 cursor-text rounded-none p-0 text-right font-normal tabular-nums text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
          style={{ fontSize: numberFontPx }}
          data-pan-disabled
          aria-label={`${label}編集を開始`}
        >{baseFontPx}{suffix}</Button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
        {ARROWS.map(([delta, Icon, title]) => {
          const step = () => { markReplace(); setBaseFontPx(prev => clampFont(prev + delta * stepSize)); };
          return (
            <Button key={delta} variant="ghost" title={title} aria-label={label === '基準フォントサイズ' ? title : `${label}を${title}`}
              {...repeat(step, { stopPropagation: true })}
              onClick={(e) => { if (e.detail === 0) step(); }}
              className={STEP_BUTTON_CLASS}
              style={{ WebkitTouchCallout: 'none' }}
              data-pan-disabled
            >
              <Icon className="size-3" aria-hidden="true" />
            </Button>
          );
        })}
      </div>
      <Button
        variant="ghost"
        onClick={() => { markReplace(); setBaseFontPx(defaultValue); }}
        title="既定値に戻す"
        aria-label={label === '基準フォントサイズ' ? '既定値に戻す' : `${label}を既定値に戻す`}
        className="h-auto select-none rounded-none p-0 text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text"
        data-pan-disabled
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
