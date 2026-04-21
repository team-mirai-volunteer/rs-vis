'use client';

import { useState, useCallback } from 'react';

interface Props {
  /** 現在の開始位置（0-based） */
  value: number;
  /** フィルタ後の支出先総数 */
  total: number;
  /** 1ページあたりの表示件数 */
  step: number;
  /** ドラッグ終了時に開始位置を通知 */
  onChangeCommitted: (newValue: number) => void;
}

export default function RecipientRangeSlider({ value, total, step, onChangeCommitted }: Props) {
  const [dragging, setDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  // 外部からの value 変更に追従（ドラッグ中でなければ）
  const displayValue = dragging ? localValue : value;

  const max = Math.max(0, Math.floor((total - 1) / step) * step);
  const startRank = displayValue + 1;
  const endRank = Math.min(displayValue + step, total);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(Number(e.target.value));
  }, []);

  const handlePointerDown = useCallback(() => {
    setDragging(true);
    setLocalValue(value);
  }, [value]);

  const handleCommit = useCallback(() => {
    setDragging(false);
    onChangeCommitted(localValue);
  }, [localValue, onChangeCommitted]);

  const handlePrev = useCallback(() => {
    const newValue = Math.max(0, value - step);
    onChangeCommitted(newValue);
  }, [value, step, onChangeCommitted]);

  const handleNext = useCallback(() => {
    const newValue = Math.min(max, value + step);
    onChangeCommitted(newValue);
  }, [value, step, max, onChangeCommitted]);

  if (total <= step) return null;

  return (
    <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-2">
      <button
        onClick={handlePrev}
        disabled={value <= 0}
        className="px-2 py-1 rounded text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default"
        aria-label="前のページ"
      >
        &lt;
      </button>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={displayValue}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handleCommit}
        onTouchEnd={handleCommit}
        className="flex-1 h-2 accent-blue-600 cursor-pointer"
      />
      <button
        onClick={handleNext}
        disabled={value >= max}
        className="px-2 py-1 rounded text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default"
        aria-label="次のページ"
      >
        &gt;
      </button>
      <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap min-w-[140px] text-right">
        {startRank.toLocaleString()}位〜{endRank.toLocaleString()}位 / {total.toLocaleString()}件
      </span>
    </div>
  );
}
