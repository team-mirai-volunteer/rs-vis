'use client';

import type { LifecycleYear, TaxItem } from '@/types/tax-burden';
import { HEATMAP_AGES } from '@/app/lib/tax-burden/simulate-lifecycle';
import { TAX_ITEMS } from '@/app/lib/tax-burden/households';

export function cellRate(y: LifecycleYear, item: TaxItem): number | null {
  if (y.income <= 0) return null;
  if (item === 'net') return y.netRateWithConsumption ?? y.netRate;
  if (item === 'consumption') return y.consumptionTax / y.income;
  if (item === 'benefits') return -y.benefits / y.income;
  return y[item] / y.income;
}

const PHASE = { work: '現役', reemployed: '継続雇用', 'work-pension': '就労＋年金', pension: '年金' } as const;

function Grid({ grid, item, compact, hasConsumption }: { grid: { income: number; cells: LifecycleYear[] }[]; item: TaxItem; compact: boolean; hasConsumption: boolean }) {
  const values = grid.flatMap(r => r.cells.map(c => cellRate(c, item))).filter((v): v is number => v !== null);
  const max = Math.max(0.005, ...values.map(v => Math.abs(v)));
  const label = TAX_ITEMS.find(t => t.id === item)!.label;
  const ages = compact ? HEATMAP_AGES.filter((_, i) => i % 2 === 0 || i === HEATMAP_AGES.length - 1) : HEATMAP_AGES;
  const rows = compact ? grid.filter((_, i) => i % 2 === 1 || i === grid.length - 1) : grid;
  return <div className={compact ? 'rounded-xl border border-mirai-border bg-card p-3' : ''}>
    {compact && <p className="mb-2 text-xs font-bold">{label}<span className="ml-2 font-normal text-mirai-text-secondary">最大 {(max * 100).toFixed(1)}%</span></p>}
    <div className="overflow-x-auto"><table className={`w-full border-separate border-spacing-0.5 tabular-nums ${compact ? 'text-[10px]' : 'text-xs'}`} aria-label={`${label}の年齢×年収ヒートマップ`}>
      <thead><tr><th scope="col" className="text-left font-normal text-mirai-text-secondary">{compact ? '年収＼年齢' : '現役期年収＼年齢'}</th>{ages.map(a => <th key={a} scope="col" className="px-1 font-normal text-mirai-text-secondary">{a}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.income}>
        <th scope="row" className="whitespace-nowrap text-left font-medium">{(row.income / 10000).toLocaleString('ja-JP')}万</th>
        {row.cells.filter(c => ages.includes(c.ageAt as typeof ages[number])).map(c => {
          const v = cellRate(c, item);
          const alpha = v === null ? 0 : Math.min(1, Math.abs(v) / max);
          const bg = v === null ? 'transparent' : v < 0 ? `rgba(217, 119, 87, ${0.12 + alpha * 0.75})` : `rgba(30, 150, 140, ${0.06 + alpha * 0.85})`;
          return <td key={c.ageAt} className={`rounded px-1 text-center ${compact ? 'py-1' : 'py-2'} ${c.outOfScope ? 'opacity-40' : ''} ${alpha > 0.6 ? 'text-white' : ''}`} style={{ backgroundColor: bg }}
            title={`${(row.income / 10000).toLocaleString('ja-JP')}万円・${c.ageAt}歳（${PHASE[c.phase]}）：総収入${Math.round(c.income / 10000).toLocaleString('ja-JP')}万円、${label} ${v === null ? '未定義' : `${(v * 100).toFixed(1)}%（${Math.round(v * c.income).toLocaleString('ja-JP')}円）`}${c.outOfScope ? '（適用範囲外）' : ''}`}>
            {v === null ? '—' : (v * 100).toFixed(compact ? 0 : 1)}
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {!compact && <p className="mt-3 text-xs leading-relaxed text-mirai-text-subtle">制度モデルの計算値です（統計の実測値ではありません）。65歳以降は年金収入が分母で、年金額は現役期年収から算出。薄いセルは就労者の給与がフルタイム下限未満。{item === 'net' && (hasConsumption ? '純負担には消費税推計を含みます。' : '消費税は消費支出データ未読込のため含まれません。')}</p>}
  </div>;
}

export function TaxHeatmap({ grid, item, hasConsumption }: { grid: { income: number; cells: LifecycleYear[] }[]; item: TaxItem; hasConsumption: boolean }) {
  const label = TAX_ITEMS.find(t => t.id === item)!.label;
  const items = TAX_ITEMS.filter(t => t.id !== 'net' && (hasConsumption || t.id !== 'consumption'));
  return <div className="space-y-6">
    <div>
      <p className="mb-2 text-xs text-mirai-text-secondary">大きい表＝{label} ÷ その年齢の総収入。行は現役期の世帯年収、列は年齢。濃いほど負担率が高い（橙は給付超過・差し引き）。左パネルの「色にする税目」で拡大する税目を選べます。</p>
      <Grid grid={grid} item={item} compact={false} hasConsumption={hasConsumption} />
    </div>
    <div>
      <h3 className="mb-1 text-sm font-bold">税目ごとに分解する</h3>
      <p className="mb-3 text-xs text-mirai-text-secondary">同じ格子を税目別に並べた小さな表（年収・年齢は間引き表示、値は%）。色の濃さは各表の最大値に対する比率なので、表の間で濃さは比べず、形（どの年齢・所得に偏るか）を比べてください。</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(t => <Grid key={t.id} grid={grid} item={t.id} compact hasConsumption={hasConsumption} />)}</div>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed text-mirai-text-secondary">
        <li>所得税・住民税は年収が高いほど、また扶養控除が切れる年齢で濃くなる（累進）。</li>
        <li>年金・雇用保険料は現役期のみで、標準報酬の上限（65万円）を超える年収では負担率が下がる（上限効果）。</li>
        <li>医療・介護保険料は65歳以降も続き、年金収入が分母になるため高齢期で相対的に重くなりやすい。</li>
        <li>消費税（推計）は年収が低いほど負担率が高い（逆進）。現金給付（児童手当・児童扶養手当）は子育て期・低所得で大きい。</li>
      </ul>
    </div>
  </div>;
}
