'use client';

/**
 * 表示設定（歯車）。ハンバーガーがヘッダーへ移ったので、コントロールパネル（右上）の右隣に置き、下へ開く。
 * 文字サイズ・ラベル表示・関連フォーカス・表示する列。
 */

import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FontSizeControls } from '@/client/components/SankeySvg/FontSizeControls';
import type { LabelDensity } from '@/types/mof-hierarchy';
import type { UnifiedColumn } from '@/types/unified-budget';
import { UnifiedColumnToggles } from './UnifiedViewSelect';

const FONT_MIN = 8;
const FONT_MAX = 20;

export function UnifiedSettings({
  fontPx,
  onFontPxChange,
  defaultFontPx,
  labelDensity,
  onLabelDensityChange,
  focusRelated,
  onFocusRelatedChange,
  visibleColumns,
  availableColumns,
  onVisibleColumnsChange,
  summary,
  placement = 'top-right',
}: {
  fontPx: number;
  onFontPxChange: (value: number) => void;
  defaultFontPx: number;
  labelDensity: LabelDensity;
  onLabelDensityChange: (value: LabelDensity) => void;
  focusRelated: boolean;
  onFocusRelatedChange: (value: boolean) => void;
  visibleColumns: UnifiedColumn[];
  availableColumns: UnifiedColumn[];
  onVisibleColumnsChange: (columns: UnifiedColumn[]) => void;
  /** 年度・純計などの要約。パネル末尾に小さく出す */
  summary?: string;
  /** 歯車の置き場所。パネルはボタンから離れる側（右上なら下、左下なら上）へ開く */
  placement?: 'top-right' | 'bottom-left';
}) {
  const popoverPos = placement === 'top-right' ? 'top-full right-0 mt-1' : 'bottom-full left-0 mb-1';
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  // 外（図のノードや他のコントロール）を押したら閉じる。開いたまま残ると図を塞ぎ続けるため
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // capture 段階で拾う。図のノードは mousedown の伝播を止めるので、バブリングでは document に届かない
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [open]);

  return (
    <div ref={rootRef} data-pan-disabled="true" className={`relative flex ${placement === 'top-right' ? 'items-start' : 'items-end'}`}>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(o => !o)}
        aria-label="表示設定を開く"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="unified-settings"
        title="表示設定（文字サイズ・表示オプション・列）"
        className={`border-mirai-border ${open ? 'bg-mirai-surface text-mirai-text' : 'text-mirai-text-subtle'}`}
      >
        <Settings className="size-[18px]" aria-hidden="true" />
      </Button>
      {open && (
        <div
          id="unified-settings"
          ref={panelRef}
          role="dialog"
          aria-label="表示設定"
          tabIndex={-1}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className={`absolute ${popoverPos} z-20 flex w-80 flex-col gap-2.5 rounded-xl border border-mirai-border bg-card px-4 py-3 text-xs text-mirai-text shadow-soft outline-none`}
          style={{ colorScheme: 'light', maxWidth: 'calc(100vw - 24px)' }}
        >
          <div>
            <div className="mb-1 font-semibold">文字サイズ</div>
            <FontSizeControls
              baseFontPx={fontPx}
              setBaseFontPx={next => onFontPxChange(typeof next === 'function' ? next(fontPx) : next)}
              markReplace={() => {}}
              isCompactWidth={false}
              min={FONT_MIN}
              max={FONT_MAX}
              defaultValue={defaultFontPx}
              controlSmallFontPx={12}
              numberFontPx={12}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={labelDensity === 'all'} onChange={e => onLabelDensityChange(e.target.checked ? 'all' : 'major')} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
            <span>すべてのノードラベルを表示</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={focusRelated} onChange={e => onFocusRelatedChange(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
            <span>選択時に関連ノードのみ表示</span>
          </label>
          <UnifiedColumnToggles visibleColumns={visibleColumns} availableColumns={availableColumns} onChange={onVisibleColumnsChange} />
          {summary && <div className="border-t border-border pt-2 text-[11px] leading-relaxed text-mirai-text-subtle">{summary}</div>}
        </div>
      )}
    </div>
  );
}
