import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FILTER_INPUT_CLASS } from './FilterTextInput';

interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  placeholder?: string;
  minWidth?: number;
  /** 未選択（すべて）表示を本文色で濃く出したい画面は 'strong' を指定する */
  placeholderTone?: 'muted' | 'strong';
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  allLabel,
  placeholder,
  minWidth = 160,
  placeholderTone = 'muted',
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const allSelected = selected.length === 0;
  const label = allSelected
    ? placeholder ?? allLabel
    : selected.length === 1
      ? selected[0]
      : `選択中 (${selected.length}/${options.length})`;

  return (
    <div className="relative flex-1" style={{ minWidth }}>
      <Button
        variant="ghost"
        size="xs"
        ref={buttonRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (buttonRef.current) {
            const r = buttonRef.current.getBoundingClientRect();
            setRect({
              top: r.bottom + 2,
              left: r.left,
              width: Math.max(r.width, 200),
              maxHeight: Math.max(160, window.innerHeight - r.bottom - 24),
            });
          }
          setOpen((v) => !v);
        }}
        className={cn(
          FILTER_INPUT_CLASS,
          'h-auto justify-start rounded-md font-normal overflow-hidden text-ellipsis whitespace-nowrap pr-6 text-left hover:bg-mirai-surface',
          allSelected && (placeholderTone === 'muted' ? 'text-mirai-text-placeholder' : 'text-mirai-text')
        )}
      >
        <span className="block w-full overflow-hidden text-ellipsis">{label}</span>
      </Button>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-mirai-text-muted transition-transform',
          open && 'rotate-180'
        )}
      />
      {!allSelected && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange([])}
          aria-label="クリア"
          className="absolute right-5 top-1/2 size-5 -translate-y-1/2 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
        >
          <X className="size-3" />
        </Button>
      )}
      {open && rect && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-multiselectable="true"
          className="fixed z-[9999] overflow-y-auto rounded-xl border border-mirai-border bg-card shadow-soft"
          style={{ top: rect.top, left: rect.left, width: rect.width, maxHeight: rect.maxHeight }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="flex cursor-pointer items-center gap-1.5 border-b border-mirai-surface-light px-2 py-1.5 text-xs font-bold text-mirai-text hover:bg-mirai-surface">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange([])}
              className="size-3 accent-primary"
            />
            <span>すべて解除</span>
          </label>
          {options.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-mirai-text hover:bg-mirai-surface"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() =>
                  onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt])
                }
                className="size-3 accent-primary"
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
