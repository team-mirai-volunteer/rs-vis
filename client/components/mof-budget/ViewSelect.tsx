'use client';

/**
 * ビュー切替のセレクト。
 *
 * 見た目は `components/navigation/YearSelect` と揃える（h-9・rounded-lg・
 * border-black/10・shadow-md・自前の矢印）。右上に年度セレクトと並べるので、
 * 高さや枠線が違うと段差になって目立つため。
 */

import { useRouter } from 'next/navigation';

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
        className="h-9 cursor-pointer appearance-none rounded-lg border border-black/10 bg-white/90 pl-2.5 pr-7 text-xs text-neutral-700 shadow-md backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        height="14"
        width="14"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 fill-neutral-400"
      >
        <path d="M7 10l5 5 5-5z" />
      </svg>
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
