'use client';

import type { LifecycleYear, TaxItem } from '@/types/tax-burden';
import { HEATMAP_AGES } from '@/app/lib/tax-burden/simulate-lifecycle';
import { TAX_ITEMS } from '@/app/lib/tax-burden/households';

export function cellRate(y: LifecycleYear, item: TaxItem): number | null {
  if (y.income <= 0) return null;
  if (item === 'net') return y.netRateWithConsumption ?? y.netRate;
  if (item === 'consumption') return y.consumptionTax / y.income;
  return y[item] / y.income;
}

export function TaxHeatmap({ grid, item, hasConsumption }: { grid: { income: number; cells: LifecycleYear[] }[]; item: TaxItem; hasConsumption: boolean }) {
  const values = grid.flatMap(r => r.cells.map(c => cellRate(c, item))).filter((v): v is number => v !== null);
  const max = Math.max(0.01, ...values.map(v => Math.abs(v)));
  const label = TAX_ITEMS.find(t => t.id === item)!.label;
  return <div>
    <p className="mb-2 text-xs text-mirai-text-secondary">セル＝{label} ÷ その年齢の総収入。行は現役期の世帯年収、列は年齢。色が濃いほど負担率が高い（負の値は給付超過）。</p>
    <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-1 text-xs tabular-nums" aria-label={`${label}の年齢×年収ヒートマップ`}>
      <thead><tr><th scope="col" className="text-left text-mirai-text-secondary">現役期年収＼年齢</th>{HEATMAP_AGES.map(a => <th key={a} scope="col" className="px-1 text-mirai-text-secondary">{a}歳</th>)}</tr></thead>
      <tbody>{grid.map(row => <tr key={row.income}>
        <th scope="row" className="whitespace-nowrap text-left font-medium">{(row.income / 10000).toLocaleString('ja-JP')}万円</th>
        {row.cells.map(c => {
          const v = cellRate(c, item);
          const alpha = v === null ? 0 : Math.min(1, Math.abs(v) / max);
          const bg = v === null ? 'transparent' : v < 0 ? `rgba(217, 119, 87, ${0.15 + alpha * 0.7})` : `rgba(30, 150, 140, ${0.08 + alpha * 0.8})`;
          return <td key={c.ageAt} className={`rounded-md px-1 py-2 text-center ${c.outOfScope ? 'opacity-40' : ''} ${alpha > 0.6 ? 'text-white' : ''}`} style={{ backgroundColor: bg }}
            title={`${(row.income / 10000).toLocaleString('ja-JP')}万円・${c.ageAt}歳（${c.phase === 'work' ? '現役' : c.phase === 'reemployed' ? '継続雇用' : c.phase === 'work-pension' ? '就労＋年金' : '年金'}）：総収入${Math.round(c.income / 10000).toLocaleString('ja-JP')}万円、${label} ${v === null ? '未定義' : `${(v * 100).toFixed(1)}%`}${c.outOfScope ? '（適用範囲外）' : ''}`}>
            {v === null ? '—' : `${(v * 100).toFixed(1)}`}
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>
    <p className="mt-3 text-xs leading-relaxed text-mirai-text-subtle">制度モデルの計算値です（統計の実測値ではありません）。65歳以降は年金収入が分母で、年金額は現役期年収から算出。薄いセルは就労者の給与がフルタイム下限未満。{!hasConsumption && '消費税は消費支出データ未読込のため含まれません。'}{hasConsumption && '純負担には消費税推計を含みます。'}</p>
  </div>;
}
