import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { PolicyComparison } from '@/types/fiscal-space';
import { KIND_LABELS, money, percent, points } from './format';

export function Comparison({ rows, horizon }: { rows: PolicyComparison[]; horizon: number }) {
  return <Card><CardHeader><h2 className="text-lg font-bold">次の1兆円を何に使うか</h2><p className="text-sm leading-relaxed">現在の配分に、各政策を<strong>1年限り・1兆円</strong>追加した差分です。成長投資の供給効果は支払後に発現します。</p><p className="text-xs leading-relaxed text-mirai-text-subtle">右端の年間上限は各政策単独を設定期間・継続方法で実施し、年0〜{horizon}の制約を調べた別の比較です。減税の法定税率変更によるCPIの直接低下はMVP対象外です。</p></CardHeader>
    <CardContent><div className="overflow-x-auto" tabIndex={0} role="region" aria-label="次の1兆円の政策比較表">
      <table className="w-full min-w-[1150px] text-left text-xs tabular-nums"><caption className="sr-only">現在の配分に対する限界効果と政策単独の年間追加上限（すべて仮定）</caption>
        <thead><tr className="border-b border-mirai-border">{['政策', '実質GDP Δ1年', '物価 Δ1年', '輸入 Δ1年', '貿易収支 Δ1年', '債務/GDP 10年', '潜在GDP Δ10年', '主な追加資源需要', '単独の年間上限'].map(h => <th key={h} scope="col" className="px-3 py-3 font-bold">{h}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.policy.id} className="border-b border-mirai-border last:border-0 hover:bg-mirai-surface-teal/60">
          <th scope="row" className="px-3 py-3 font-medium">{row.policy.name}</th>
          <td className="px-3 py-3">{money(row.realGdpEffect, 3)}</td><td className="px-3 py-3">{points(row.inflationPressure)}</td>
          <td className="px-3 py-3">{money(row.imports, 3)}</td><td className="px-3 py-3">{money(row.tradeBalanceEffect, 3)}</td>
          <td className="px-3 py-3">{percent(row.debtGdp10y)}<span className="mt-1 block text-mirai-text-subtle">差 {points(row.debtGdpChange10y)}</span></td>
          <td className="px-3 py-3">{money(row.potentialGdpEffect, 3)}</td><td className="px-3 py-3">{row.mainCapacity}</td>
          <td className="px-3 py-3"><strong>{row.space.status === 'search-cap' ? '≥ ' : ''}{money(row.space.theoreticalMaximum)}</strong><span className="mt-1 block text-mirai-text-subtle">{KIND_LABELS[row.policy.kind]}・{row.policy.kind === 'permanent' ? '継続' : `${row.policy.duration}年支出`}</span><span className="mt-1 block">{row.space.status === 'search-cap' ? '境界未特定' : row.space.status === 'baseline-violated' ? '基準経路が違反' : row.space.constraints[0]?.label}</span></td>
        </tr>)}</tbody>
      </table>
    </div></CardContent>
  </Card>;
}
