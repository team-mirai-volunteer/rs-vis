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

interface TopNSliderRowProps {
  label: string;
  value: number;
  setValue: Dispatch<SetStateAction<number>>;
  markReplace: () => void;
  metaFontPx: number;
}

function TopNSliderRow({ label, value, setValue, markReplace, metaFontPx }: TopNSliderRowProps) {
  const [local, setLocal] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const repeat = useRepeatPress();
  const commit = (v: number) => { markReplace(); setValue(clampTop(v)); };
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span style={{ color: '#555', fontSize: metaFontPx, whiteSpace: 'nowrap', width: '3.5em', flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={TOP_MIN} max={TOP_MAX} step={1}
        value={local ?? value}
        onChange={e => { setLocal(Number(e.target.value)); }}
        onPointerUp={e => { commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        onPointerCancel={() => { setLocal(null); }}
        onLostPointerCapture={() => { setLocal(null); }}
        onTouchEnd={e => { commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        onKeyUp={e => { commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        onBlur={e => { if (local === null) return; commit(Number((e.target as HTMLInputElement).value)); setLocal(null); }}
        style={{ flex: 1, minWidth: 0, width: 0 }}
      />
      {isEditing ? (
        <input type="number" autoFocus min={TOP_MIN} max={TOP_MAX} step={1}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { const v = Number(inputValue); if (!isNaN(v) && v >= 1) commit(v); setIsEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
          style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: metaFontPx }}
        />
      ) : (
        <button onClick={() => { setInputValue(String(value)); setIsEditing(true); }} title="クリックして直接入力"
          style={{ color: '#999', fontSize: metaFontPx, background: 'transparent', border: 'none', cursor: 'text', padding: 0, minWidth: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
        >{local ?? value}</button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
        {ARROW_PATHS.map(([delta, path, title]) => {
          const step = () => { markReplace(); setValue(prev => clampTop(prev + delta)); };
          return (
            <button key={delta} title={title} aria-label={title}
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
