'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

const TOP_MIN = 1;
const TOP_MAX = 300;

// [delta, アイコン, ラベル]
const ARROWS: [number, typeof ChevronUp, string][] = [
  [1, ChevronUp, '増やす'],
  [-1, ChevronDown, '減らす'],
];

/** 上下矢印（長押し対応）の共通クラス。縦2段で並べるため高さは親に合わせる */
const STEP_BUTTON_CLASS =
  'h-auto w-4 flex-1 select-none touch-none rounded-none p-0 text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text';

export interface TopNSliderRowProps {
  label: string;
  value: number;
  setValue: Dispatch<SetStateAction<number>>;
  markReplace: () => void;
  metaFontPx: number;
  /**
   * スライダーと数値の読み上げ名。
   * label だけだと1つの <label> に入力が3つぶら下がって指し先が定まらない。
   * 省略時は付けない（既存の呼び出し元の読み上げを変えないため）。
   */
  inputLabel?: string;
  /** スライダーの上限。既定は 300 */
  max?: number;
}

/** TopN 1行ぶん（スライダー＋直接入力＋長押しの増減） */
export function TopNSliderRow({
  label,
  value,
  setValue,
  markReplace,
  metaFontPx,
  inputLabel,
  max = TOP_MAX,
}: TopNSliderRowProps) {
  const [local, setLocal] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const repeat = useRepeatPress();
  const clamp = (v: number) => Math.max(TOP_MIN, Math.min(max, v));
  const commit = (v: number) => { markReplace(); setValue(clamp(v)); };
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span className="text-mirai-text-subtle" style={{ fontSize: metaFontPx, whiteSpace: 'nowrap', width: '3.5em', flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={TOP_MIN} max={max} step={1}
        aria-label={inputLabel}
        value={local ?? value}
        onChange={e => { setLocal(Number(e.target.value)); }}
        onPointerUp={e => { commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        onPointerCancel={() => { setLocal(null); }}
        onLostPointerCapture={() => { setLocal(null); }}
        onTouchEnd={e => { commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        onKeyUp={e => { commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        onBlur={e => { if (local === null) return; commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        className="policy-range"
        style={{ flex: 1, minWidth: 0, width: 0 }}
      />
      {isEditing ? (
        <input type="number" autoFocus min={TOP_MIN} max={max} step={1}
          aria-label={inputLabel ? `${inputLabel}(数値)` : undefined}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { const v = Number(inputValue); if (!isNaN(v) && v >= 1) commit(v); setIsEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
          className="rounded-md border border-mirai-border bg-card text-center text-mirai-text focus-visible:border-primary"
          style={{ width: 36, fontSize: metaFontPx }}
        />
      ) : (
        <Button variant="ghost" onClick={() => { setInputValue(String(value)); setIsEditing(true); }} title="クリックして直接入力"
          aria-label={inputLabel ? `${inputLabel}を直接入力` : undefined}
          className="h-auto min-w-5 cursor-text rounded-none p-0 text-right font-normal tabular-nums text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
          style={{ fontSize: metaFontPx }}
        >{local ?? value}</Button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
        {ARROWS.map(([delta, Icon, title]) => {
          const step = () => { markReplace(); setValue(prev => clamp(prev + delta)); };
          return (
            <Button key={delta} variant="ghost" title={title} aria-label={inputLabel ? `${inputLabel}を${title}` : title}
              {...repeat(step)}
              onClick={(e) => { if (e.detail === 0) step(); }}
              className={STEP_BUTTON_CLASS}
              style={{ WebkitTouchCallout: 'none' }}
            >
              <Icon className="size-3" aria-hidden="true" />
            </Button>
          );
        })}
      </div>
    </label>
  );
}

interface TopNSlidersProps {
  topProject: number;
  topRecipient: number;
  setTopProject: Dispatch<SetStateAction<number>>;
  setTopRecipient: Dispatch<SetStateAction<number>>;
  markReplace: () => void;
  metaFontPx: number;
}

/** 事業・支出先 TopN スライダー（デスクトップはオフセットパネル内、スマホ幅では設定ダイアログ内に表示） */
export function TopNSliders({ topProject, topRecipient, setTopProject, setTopRecipient, markReplace, metaFontPx }: TopNSlidersProps) {
  return (
    <>
      <TopNSliderRow label="事業" value={topProject} setValue={setTopProject} markReplace={markReplace} metaFontPx={metaFontPx} />
      <TopNSliderRow label="支出先" value={topRecipient} setValue={setTopRecipient} markReplace={markReplace} metaFontPx={metaFontPx} />
    </>
  );
}
