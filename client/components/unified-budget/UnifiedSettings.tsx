'use client';

/**
 * 表示設定（歯車）。ハンバーガーがヘッダーへ移ったので、コントロールパネル（右上）の右隣に置き、下へ開く。
 * 文字サイズ・ラベル表示・関連フォーカス・事業の並び順・表示する列。
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FontSizeControls } from '@/client/components/SankeySvg/FontSizeControls';
import type { LabelDensity } from '@/types/mof-hierarchy';
import type { UnifiedColumn } from '@/types/unified-budget';
import { UNIFIED_PROGRAM_SORTS, UNIFIED_PROGRAM_SORT_LABELS, type UnifiedProgramSort } from '@/types/unified-budget-view';
import { UnifiedColumnToggles } from './UnifiedViewSelect';
import { FLOW_SCALE_DEFAULT, FLOW_SCALE_MIN, FLOW_SCALE_MAX } from '@/client/lib/unified-flow-scale';

const FONT_MIN = 8;
const FONT_MAX = 20;

/** 差額の説明（UnifiedProjectBlocks の差額表示と同じ言い回し） */
const DIFF_NOTE = '差額は、直下に再委託先を持つブロックの「ブロックの記載額 − 直下の再委託先の記載額」を事業ごとに合計したもの（差額%はその合計÷当該ブロックの記載額の合計）。記載額の差であり、実際の受取額や利益を示すものではありません。';

export function UnifiedSettings({
  fontPx,
  onFontPxChange,
  defaultFontPx,
  flowScale,
  onFlowScaleChange,
  labelDensity,
  onLabelDensityChange,
  focusRelated,
  onFocusRelatedChange,
  visibleColumns,
  availableColumns,
  onVisibleColumnsChange,
  programSort = 'amount',
  onProgramSortChange,
  programSortStatus = 'ready',
  summary,
  placement = 'top-right',
}: {
  fontPx: number;
  onFontPxChange: (value: number) => void;
  defaultFontPx: number;
  flowScale: number;
  onFlowScaleChange: Dispatch<SetStateAction<number>>;
  labelDensity: LabelDensity;
  onLabelDensityChange: (value: LabelDensity) => void;
  focusRelated: boolean;
  onFocusRelatedChange: (value: boolean) => void;
  visibleColumns: UnifiedColumn[];
  availableColumns: UnifiedColumn[];
  onVisibleColumnsChange: (columns: UnifiedColumn[]) => void;
  /** 事業列の並び順（事業(支出) も従う）。onProgramSortChange が無ければ出さない */
  programSort?: UnifiedProgramSort;
  onProgramSortChange?: (value: UnifiedProgramSort) => void;
  /** 並べ替えの値の取得状況。loading・unavailable の間は金額順のまま */
  programSortStatus?: 'ready' | 'loading' | 'unavailable';
  /** 年度・純計などの要約。パネル末尾に小さく出す */
  summary?: string;
  /** 歯車の置き場所。パネルはボタンから離れる側（右上なら下、左下なら上）へ開く */
  placement?: 'top-right' | 'bottom-left' | 'top-auto' | 'bottom-right';
  // 'top-auto': sm 未満は右上（右揃え）、sm 以上は左上（左揃え）に置かれる前提でパネルの寄せを切り替える
}) {
  const popoverPos = placement === 'top-right' ? 'top-full right-0 mt-1' : placement === 'top-auto' ? 'top-full right-0 mt-1 sm:left-0 sm:right-auto' : placement === 'bottom-right' ? 'bottom-full right-0 mb-1' : 'bottom-full left-0 mb-1';
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 図コンテナは overflow-hidden。スクロールさせると閉じた後もコントロールがずれたまま戻らない
    if (open) panelRef.current?.focus({ preventScroll: true });
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
    <div ref={rootRef} data-pan-disabled="true" className={`pointer-events-auto relative flex ${placement === 'bottom-left' || placement === 'bottom-right' ? 'items-end' : 'items-start'}`}>
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
          style={{ colorScheme: 'light', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - var(--app-header-h, 64px) - 72px)', overflowY: 'auto' }}
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
          <div>
            <div className="mb-1 font-semibold">帯・ノードの太さ</div>
            <FontSizeControls baseFontPx={flowScale}
              setBaseFontPx={onFlowScaleChange}
              markReplace={() => {}} isCompactWidth={false}
              min={FLOW_SCALE_MIN} max={FLOW_SCALE_MAX} defaultValue={FLOW_SCALE_DEFAULT}
              stepSize={.1} label="帯・ノードの太さ" suffix="倍" controlSmallFontPx={12} numberFontPx={12} />
            <p className="mt-1 leading-relaxed text-mirai-text-subtle">金額比を保って太くします。下にはみ出した部分は図をドラッグして表示できます。</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={labelDensity === 'all'} onChange={e => onLabelDensityChange(e.target.checked ? 'all' : 'major')} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
            <span>すべてのノードラベルを表示</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={focusRelated} onChange={e => onFocusRelatedChange(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
            <span>選択時に関連ノードのみ表示</span>
          </label>
          {onProgramSortChange && <div>
            <label htmlFor="unified-program-sort" className="mb-1 block font-semibold">事業の並び順</label>
            <select id="unified-program-sort" value={programSort} onChange={e => onProgramSortChange(e.target.value as UnifiedProgramSort)}
              className="h-7 w-full cursor-pointer rounded-md border border-mirai-border bg-card px-1.5 text-mirai-text outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40">
              {UNIFIED_PROGRAM_SORTS.map(k => <option key={k} value={k}>{UNIFIED_PROGRAM_SORT_LABELS[k]}</option>)}
            </select>
            <p className="mt-1 leading-relaxed text-mirai-text-subtle">
              {programSortStatus === 'loading' ? '値を読み込み中です（それまでは金額順）。'
                : programSortStatus === 'unavailable' ? 'この年度・ビューでは値が無いため金額順で表示しています。'
                : programSort === 'amount' ? '事業列の表示数（上位N件）も金額の大きい順で選びます。'
                : '事業列の表示数（上位N件）もこの順で選びます。値の無い事業は後ろに並べます。'}
              {(programSort === 'diff' || programSort === 'ratio') && <span className="mt-1 block" title={DIFF_NOTE}>{DIFF_NOTE}</span>}
            </p>
          </div>}
          <UnifiedColumnToggles visibleColumns={visibleColumns} availableColumns={availableColumns} onChange={onVisibleColumnsChange} />
          {summary && <div className="border-t border-border pt-2 text-[11px] leading-relaxed text-mirai-text-subtle">{summary}</div>}
        </div>
      )}
    </div>
  );
}
