'use client';

/**
 * 表示設定（⋮）。
 *
 * /sankey-svg と同じく、頻繁には触らない見た目の設定をここに畳む。
 * TopN と表示位置は探索しながら何度も動かすので、こちらには入れず
 * 常時見えるパネル（HierarchyControls）に置く。
 */

import { useEffect, useRef, useState } from 'react';
import type { LabelDensity } from '@/types/mof-hierarchy';

const SELECT_CLASS =
  'h-7 cursor-pointer rounded border border-gray-300 bg-white px-1.5 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** 文字サイズの選択肢（px）。大きくするとノード間隔も広がり、縦に長くなる */
const FONT_PX_OPTIONS = [9, 10, 11, 12, 14, 16, 18];

export function HierarchySettings({
  fontPx,
  onFontPxChange,
  labelDensity,
  onLabelDensityChange,
  focusRelated,
  onFocusRelatedChange,
  summary,
}: {
  fontPx: number;
  onFontPxChange: (value: number) => void;
  labelDensity: LabelDensity;
  onLabelDensityChange: (value: LabelDensity) => void;
  focusRelated: boolean;
  onFocusRelatedChange: (value: boolean) => void;
  /** 事項数・会計区分の内訳 */
  summary?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 外側を押したら閉じる。開いたままだと図のクリックを奪う
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="表示設定"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/90 text-gray-500 shadow-md backdrop-blur hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {/* Material Icons: more_vert */}
        <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2Zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex flex-col gap-2 text-xs text-gray-600">
            <label className="flex items-center justify-between gap-2">
              <span className="font-medium">文字サイズ</span>
              <select
                aria-label="文字サイズ"
                value={fontPx}
                onChange={e => onFontPxChange(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {FONT_PX_OPTIONS.map(n => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-2">
              <span className="font-medium">ラベル表示</span>
              <select
                aria-label="ラベル表示"
                value={labelDensity}
                onChange={e => onLabelDensityChange(e.target.value as LabelDensity)}
                className={SELECT_CLASS}
              >
                <option value="all">すべて</option>
                <option value="major">主要なノードのみ</option>
              </select>
            </label>

            <label className="flex cursor-pointer items-center gap-1.5 pt-1">
              <input
                type="checkbox"
                checked={focusRelated}
                onChange={e => onFocusRelatedChange(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <span>選択時に関連のみ表示</span>
            </label>

            {summary && (
              <p className="border-t border-gray-100 pt-2 text-[11px] text-gray-500">
                {summary}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
