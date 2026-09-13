'use client';

/**
 * 数値列（本年度額・事項数など）の範囲フィルタ用デュアルハンドルスライダー。
 * `<input type="range">` を2本重ねる定番実装。金額のように裾が極端に長い分布は
 * `scale="log"` で対数目盛にし、スライダー中央付近でも実用的な粒度になるようにする。
 */

import { useId, useState } from 'react';

const STEPS = 1000;

function toPos(value: number, domainMin: number, domainMax: number, scale: 'linear' | 'log'): number {
  if (domainMax <= domainMin) return 0;
  if (scale === 'log') {
    const lo = Math.log1p(Math.max(0, domainMin));
    const hi = Math.log1p(Math.max(0, domainMax));
    if (hi <= lo) return 0;
    return ((Math.log1p(Math.max(0, value)) - lo) / (hi - lo)) * STEPS;
  }
  return ((value - domainMin) / (domainMax - domainMin)) * STEPS;
}

function fromPos(pos: number, domainMin: number, domainMax: number, scale: 'linear' | 'log'): number {
  if (scale === 'log') {
    const lo = Math.log1p(Math.max(0, domainMin));
    const hi = Math.log1p(Math.max(0, domainMax));
    return Math.expm1(lo + (pos / STEPS) * (hi - lo));
  }
  return domainMin + (pos / STEPS) * (domainMax - domainMin);
}

export interface RangeSliderProps {
  label: string;
  note?: string;
  domainMin: number;
  domainMax: number;
  /** null は「未設定＝domainMin/domainMax」を意味する */
  value: [number | null, number | null];
  onChange: (value: [number | null, number | null]) => void;
  formatValue: (v: number) => string;
  scale?: 'linear' | 'log';
}

// input自体の高さはコンテナ(h-4)いっぱいに取る。Thumb(14px)より箱が小さいと、ブラウザが
// Thumbを箱の中央ではなく上端基準で描画し縦がズレるため、箱の高さをThumb以上に確保する。
// トラックの細い線・選択範囲のハイライトは別の<div>で下に敷き、input自身のトラックは透明にする
const trackClass =
  'pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent ' +
  '[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 ' +
  '[&::-webkit-slider-thumb]:mt-0 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full ' +
  '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-neutral-400 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow ' +
  'dark:[&::-webkit-slider-thumb]:border-neutral-500 dark:[&::-webkit-slider-thumb]:bg-neutral-200 ' +
  '[&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:border-0 ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full ' +
  '[&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-neutral-400 [&::-moz-range-thumb]:bg-white';

/** 項一覧の数値列を絞り込むレンジスライダー（下ハンドル・上ハンドルの2本＋直接入力） */
export function RangeSlider({ label, note, domainMin, domainMax, value, onChange, formatValue, scale = 'linear' }: RangeSliderProps) {
  const id = useId();
  const [min, max] = value;
  const effMin = min ?? domainMin;
  const effMax = max ?? domainMax;
  const posMin = toPos(effMin, domainMin, domainMax, scale);
  const posMax = toPos(effMax, domainMin, domainMax, scale);
  const isActive = min !== null || max !== null;
  const [editing, setEditing] = useState(false);

  function commitMin(pos: number) {
    const v = fromPos(Math.min(pos, posMax), domainMin, domainMax, scale);
    onChange([v <= domainMin ? null : v, max]);
  }
  function commitMax(pos: number) {
    const v = fromPos(Math.max(pos, posMin), domainMin, domainMax, scale);
    onChange([min, v >= domainMax ? null : v]);
  }

  if (domainMax <= domainMin) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-neutral-500" title={note}>
          {label}
        </span>
        <div className="flex items-center gap-1">
          {isActive && (
            <button
              type="button"
              onClick={() => onChange([null, null])}
              className="text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              title="この範囲をリセット"
            >
              リセット
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(v => !v)}
            className="text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            title="数値を直接入力"
          >
            直接入力
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            aria-label={`${label}の下限`}
            value={min ?? ''}
            placeholder={String(domainMin)}
            onChange={e => onChange([e.target.value === '' ? null : Number(e.target.value), max])}
            className="w-full min-w-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span className="text-neutral-400">〜</span>
          <input
            type="number"
            aria-label={`${label}の上限`}
            value={max ?? ''}
            placeholder={String(domainMax)}
            onChange={e => onChange([min, e.target.value === '' ? null : Number(e.target.value)])}
            className="w-full min-w-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      ) : (
        <>
          <div className="relative h-4">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-200 dark:bg-neutral-700" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500"
              style={{ left: `${(posMin / STEPS) * 100}%`, right: `${100 - (posMax / STEPS) * 100}%` }}
            />
            <input
              id={`${id}-min`}
              type="range"
              min={0}
              max={STEPS}
              value={posMin}
              onChange={e => commitMin(Number(e.target.value))}
              aria-label={`${label}の下限`}
              className={trackClass}
            />
            <input
              id={`${id}-max`}
              type="range"
              min={0}
              max={STEPS}
              value={posMax}
              onChange={e => commitMax(Number(e.target.value))}
              aria-label={`${label}の上限`}
              className={trackClass}
            />
          </div>
          <div className="flex justify-between text-[10px] tabular-nums text-neutral-500">
            <span>{formatValue(effMin)}</span>
            <span>{formatValue(effMax)}</span>
          </div>
        </>
      )}
    </div>
  );
}
