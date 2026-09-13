'use client';

import { ChevronDown } from 'lucide-react';
import { UNIFIED_BASES, UNIFIED_BASIS_LABELS, type UnifiedBasis } from '@/types/unified-budget';

/**
 * 予算の基準（当初予算・補正予算・決算）のセレクト。表示プリセットの左に置く。
 * 年度によって生成済みの基準が違うので、無いものは disabled で出す（選択肢の並びは固定）。
 */
export function UnifiedBasisSelect({
  value,
  available,
  onChange,
}: {
  value: UnifiedBasis;
  available: readonly UnifiedBasis[];
  onChange: (basis: UnifiedBasis) => void;
}) {
  return (
    <div className="relative shrink-0" data-pan-disabled="true">
      <select
        value={value}
        aria-label="予算の基準"
        title="会計〜目の流量と RS事業の値をどの基準で見るか（当初予算 / 補正予算の改予算額 / 決算の支出済額）"
        onChange={e => onChange(e.target.value as UnifiedBasis)}
        className="h-9 cursor-pointer appearance-none rounded-full border border-mirai-border bg-card pl-3 pr-8 text-xs font-bold text-mirai-text shadow-xs transition-colors hover:bg-mirai-surface focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      >
        {UNIFIED_BASES.map(b => (
          <option key={b} value={b} disabled={!available.includes(b)}>
            {UNIFIED_BASIS_LABELS[b]}
            {available.includes(b) ? '' : '（未収録）'}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mirai-text-muted" />
    </div>
  );
}
