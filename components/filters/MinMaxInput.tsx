import type { CSSProperties } from 'react';
import { parseAmountToYen } from '@/app/lib/format/yen';

interface MinMaxInputProps {
  minVal: string;
  maxVal: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}

export function MinMaxInput({
  minVal,
  maxVal,
  onMinChange,
  onMaxChange,
}: MinMaxInputProps) {
  const minOk = !minVal || parseAmountToYen(minVal) !== null;
  const maxOk = !maxVal || parseAmountToYen(maxVal) !== null;
  const inputStyle = (ok: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    border: `1px solid ${ok ? '#ddd' : '#e53935'}`,
    borderRadius: 4,
    padding: '3px 6px',
    background: '#fafafa',
    color: '#333',
    outline: 'none',
  });

  return (
    <>
      <input
        type="text"
        value={minVal}
        onChange={(e) => onMinChange(e.target.value)}
        placeholder="下限"
        title="下限 (例: 100億, 1兆)"
        style={inputStyle(minOk)}
      />
      <span style={{ color: '#aaa', fontSize: 11 }}>〜</span>
      <input
        type="text"
        value={maxVal}
        onChange={(e) => onMaxChange(e.target.value)}
        placeholder="上限"
        title="上限 (例: 1兆, 5000億)"
        style={inputStyle(maxOk)}
      />
      {(minVal || maxVal) && (
        <button
          type="button"
          onClick={() => { onMinChange(''); onMaxChange(''); }}
          aria-label="クリア"
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11, flexShrink: 0 }}
        >
          ✕
        </button>
      )}
    </>
  );
}
