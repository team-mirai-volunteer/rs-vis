import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  placeholder?: string;
  minWidth?: number;
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  allLabel,
  placeholder,
  minWidth = 160,
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
    <div style={{ position: 'relative', minWidth, flex: 1 }}>
      <button
        type="button"
        ref={buttonRef}
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
        style={{
          width: '100%',
          fontSize: 12,
          border: '1px solid #ddd',
          borderRadius: 4,
          padding: '3px 22px 3px 6px',
          background: '#fafafa',
          color: allSelected ? '#aaa' : '#333',
          cursor: 'pointer',
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          outline: 'none',
        }}
      >
        {label}
      </button>
      <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#aaa"
        style={{ position: 'absolute', right: 6, top: '50%', transform: open ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)', transition: 'transform 0.15s', pointerEvents: 'none' }}>
        <path d="M7 10l5 5 5-5z"/>
      </svg>
      {!allSelected && (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="クリア"
          style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11 }}
        >
          ✕
        </button>
      )}
      {open && rect && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            overflowY: 'auto',
            zIndex: 9999,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange([])}
              style={{ width: 12, height: 12 }}
            />
            <span style={{ fontSize: 12, color: '#333' }}>すべて解除</span>
          </label>
          {options.map((opt) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() =>
                  onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt])
                }
                style={{ width: 12, height: 12 }}
              />
              <span style={{ fontSize: 12, color: '#333' }}>{opt}</span>
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
