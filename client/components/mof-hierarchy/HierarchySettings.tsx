'use client';

/**
 * 表示設定（⋮）。
 *
 * /sankey-svg と同じく、頻繁には触らない見た目の設定をここに畳む。
 * TopN と表示位置は探索しながら何度も動かすので、こちらには入れず
 * 常時見えるパネル（HierarchyControls）に置く。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LabelDensity } from '@/types/mof-hierarchy';

const SELECT_CLASS =
  'h-7 cursor-pointer rounded border border-mirai-border bg-card px-1.5 text-xs text-mirai-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

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
  extra,
}: {
  fontPx: number;
  onFontPxChange: (value: number) => void;
  labelDensity: LabelDensity;
  onLabelDensityChange: (value: LabelDensity) => void;
  focusRelated: boolean;
  onFocusRelatedChange: (value: boolean) => void;
  /** 事項数・会計区分の内訳 */
  summary?: string;
  /** ページ固有の設定（統合ビューの列トグルなど）。関連表示チェックの下に出す */
  extra?: ReactNode;
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
      <Button
        variant="outline"
        size="icon"
        aria-label="表示設定"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="size-8 border-mirai-border bg-card text-mirai-text-muted hover:bg-card"
      >
        <MoreVertical className="size-[18px]" aria-hidden="true" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-border bg-card p-3 shadow-soft">
          <div className="flex flex-col gap-2 text-xs text-mirai-text-subtle">
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
            {extra}

            {summary && (
              <p className="border-t border-border pt-2 text-[11px] text-mirai-text-muted">
                {summary}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
