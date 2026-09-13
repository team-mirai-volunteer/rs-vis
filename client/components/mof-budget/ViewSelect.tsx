'use client';

/**
 * ビュー切替のセレクト。
 *
 * 見た目は `components/navigation/YearSelect` と揃える（h-9・rounded-full・
 * border-mirai-border・shadow-xs・lucide の矢印）。右上に年度セレクトと並べるので、
 * 高さや枠線が違うと段差になって目立つため。
 */

import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

export interface ViewOption {
  value: string;
  label: string;
  href: string;
}

export function ViewSelect({
  value,
  options,
}: {
  value: string;
  options: ViewOption[];
}) {
  const router = useRouter();
  if (options.length <= 1) return null;
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        aria-label="ビュー"
        onChange={e => {
          const next = options.find(o => o.value === e.target.value);
          if (next) router.push(next.href);
        }}
        className="h-9 cursor-pointer appearance-none rounded-full border border-mirai-border bg-card pl-3 pr-8 text-xs font-bold text-mirai-text shadow-xs transition-colors hover:bg-mirai-surface focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mirai-text-muted"
      />
    </div>
  );
}

/** 2つのビューは相互に行き来するだけなので、選択肢はここに置いて両ページで共有する */
export function mofBudgetViewOptions(fiscalYear: number): ViewOption[] {
  return [
    { value: 'overview', label: '全体フロー', href: `/mof-budget-overview?year=${fiscalYear}` },
    {
      value: 'transfer',
      label: '特別会計 財源内訳',
      href: `/mof-budget-overview/transfer-detail?year=${fiscalYear}`,
    },
  ];
}
