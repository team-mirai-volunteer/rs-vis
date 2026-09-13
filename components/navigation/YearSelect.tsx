'use client';

import { ChevronDown } from 'lucide-react';

/**
 * 年度セレクト。全ページ共通で PageNavMenu の左隣に置く。
 *
 * 見た目は PageNavMenu のボタン（h-9・白・mirai-border・shadow-xs）に揃える。
 * 矢印は appearance:none ＋ lucide アイコンに統一する。ネイティブのままだと
 * ブラウザ・OS で形と幅が変わり、隣のメニューボタンと高さが揃わないため。
 */

export function YearSelect({
  value,
  onChange,
  years,
  fontPx,
  testId,
}: {
  value: string;
  onChange: (year: string) => void;
  years: readonly (string | number)[];
  /** 互換用。デザインシステム適用後は常にライト配色のため未使用 */
  theme?: 'auto' | 'light';
  /** フォントスケール対応ページ用。未指定なら text-xs 相当 */
  fontPx?: number;
  testId?: string;
}) {
  return (
    <div className="relative shrink-0">
      <select
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="年度"
        style={fontPx ? { fontSize: fontPx } : undefined}
        className="h-9 cursor-pointer appearance-none rounded-full border border-mirai-border bg-card pl-3 pr-8 text-xs font-bold text-mirai-text shadow-xs transition-colors hover:bg-mirai-surface focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      >
        {years.map(y => (
          <option key={y} value={String(y)}>{y}年度</option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mirai-text-muted"
      />
    </div>
  );
}
