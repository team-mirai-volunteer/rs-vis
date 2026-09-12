'use client';

/**
 * チェックボックス付きの複数選択コンボボックス。`/sankey-svg` の省庁・会計区分フィルタと
 * 同じ見た目・挙動（ボタン→ドロップダウンportal→クリック外で閉じる）を踏襲する。
 * 空配列 = 絞り込みなし（すべて通す）。1件でもチェックすると、それ以降はチェックした
 * ものだけを通すホワイトリストになる（他のチェックボックスは見た目上チェックが付かない）。
 *
 * 開閉状態は呼び出し側（FilterSidebar）が controlled で持つ。同時に複数のコンボを
 * 独立してuseStateで開閉させると、片方が「外側クリック」の判定でもう片方のトリガー
 * ボタンをまたぐ際に、閉じたつもりが別のコンボが開いて紛らわしい・チラつくことが
 * あったため、どのフィールドが開いているかをFilterSidebar側で一元管理し、開くときに
 * 他を必ず閉じるようにしている。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MultiSelectComboProps {
  label: string;
  options: string[];
  /** 空配列は「すべて」（絞り込みなし） */
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function MultiSelectCombo({ label, options, selected, onChange, disabled, open, onOpenChange }: MultiSelectComboProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const allSelected = selected.length === 0;
  const displayLabel = allSelected ? `すべて（${options.length}）` : selected.length === 1 ? selected[0] : `選択中（${selected.length}/${options.length}）`;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    const recompute = () => {
      if (buttonRef.current) {
        const r = buttonRef.current.getBoundingClientRect();
        setRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open, onOpenChange]);

  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter(o => o !== option) : [...selected, option]);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (!open && buttonRef.current) {
            const r = buttonRef.current.getBoundingClientRect();
            setRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
          }
          onOpenChange(!open);
        }}
        className={`flex w-full items-center justify-between gap-1 truncate rounded border border-neutral-300 bg-white px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 ${
          allSelected ? 'text-neutral-400' : 'text-neutral-800 dark:text-neutral-200'
        }`}
      >
        <span className="truncate">{displayLabel}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 -960 960 960"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0 text-neutral-400"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M480-360 280-560h400L480-360Z" />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, maxHeight: rect.maxHeight }}
            className="z-[9999] overflow-y-auto rounded border border-neutral-300 bg-white text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            onMouseDown={e => e.stopPropagation()}
          >
            <label className="flex cursor-pointer items-center gap-1.5 border-b border-neutral-200 px-2 py-1.5 font-semibold dark:border-neutral-800">
              <input type="checkbox" checked={allSelected} onChange={() => onChange([])} className="h-3 w-3" />
              <span>すべて選択/解除</span>
            </label>
            {options.map(o => (
              <label key={o} className="flex cursor-pointer items-center gap-1.5 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <input type="checkbox" checked={!allSelected && selected.includes(o)} onChange={() => toggle(o)} className="h-3 w-3 shrink-0" />
                <span className="truncate">{o}</span>
              </label>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
