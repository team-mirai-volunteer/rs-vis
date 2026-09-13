import Link from 'next/link';
import { ArrowUpRight, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import type { TaxRevenue } from '@/types/tax-burden';

export function RevenuePanel({ data, onCompareIncomeTax }: { data: TaxRevenue; onCompareIncomeTax: () => void }) {
  const rows = [...data.taxes, { name: '印紙収入', amount: data.stamp }].sort((a, b) => b.amount - a.amount);
  const max = Math.max(...rows.map(r => r.amount));
  return <div className="space-y-5">
    <Card className="bg-mirai-surface-teal"><CardHeader><div className="flex items-center gap-2 text-primary-accent"><Landmark className="size-5" /><h2 className="font-bold">一般会計の租税・印紙収入</h2></div></CardHeader>
      <CardContent><p className="text-4xl font-bold tabular-nums">{formatBudgetFromYen(data.total)}</p><p className="mt-3 text-sm">{data.metadata.fiscalYear}年度・{data.metadata.budgetType}。地方税・社会保険料は含めません。</p></CardContent>
    </Card>
    <Card><CardHeader><h2 className="font-bold">どの税が、どれだけを占めるか</h2><p className="text-xs text-mirai-text-secondary">所得税は源泉・申告を分け、予算書の項名をそのまま表示しています。</p></CardHeader>
      <CardContent><table className="w-full text-sm"><thead><tr className="text-xs text-mirai-text-secondary"><th scope="col" className="pb-3 text-left">税目</th><th scope="col" className="pb-3 text-right">予算額</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.name} className="border-t border-mirai-border/30"><th scope="row" className="w-3/5 py-3 pr-4 text-left font-medium">
          {row.name}<div className="mt-2 h-2 overflow-hidden rounded-full bg-mirai-surface"><div className="h-full rounded-full bg-primary" style={{ width: `${row.amount / max * 100}%` }} /></div>
        </th><td className="text-right font-bold tabular-nums">{formatBudgetFromYen(row.amount)}</td></tr>)}</tbody>
      </table>
      <div className="mt-6 flex flex-wrap gap-3"><Button onClick={onCompareIncomeTax}>所得税の世帯負担を見る<ArrowUpRight /></Button><Button variant="outline" asChild><Link href={`/mof-budget-overview?year=${data.metadata.fiscalYear}`}>予算全体を見る</Link></Button></div>
      <p className="mt-5 text-xs leading-relaxed text-mirai-text-secondary">出典：{data.metadata.source}。既存データの税目合計と租税款の一致を検証しています。保険料収入の分離、地方税決算、国民負担率の公表値は未収録です。国税予算と地方税決算は合算しません。</p>
      </CardContent>
    </Card>
  </div>;
}
