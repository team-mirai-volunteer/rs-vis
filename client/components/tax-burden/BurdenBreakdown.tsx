import type { BurdenResult, FiscalImpact } from '@/types/tax-burden';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export const yen = (n: number) => `${(Math.round(n) || 0).toLocaleString('ja-JP')}円`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${yen(n)}`;

export function BurdenBreakdown({ before, after, impact }: { before: BurdenResult; after?: BurdenResult; impact?: FiscalImpact }) {
  const rows = [
    ['所得税（復興特別所得税込み）', before.incomeTax, after?.incomeTax],
    ['住民税', before.residentTax, after?.residentTax],
    ['厚生年金・本人負担', before.pension, after?.pension],
    ['健康保険・本人負担', before.health, after?.health],
    ['介護保険・本人負担', before.care, after?.care],
    ['雇用保険・本人負担', before.employment, after?.employment],
    ['児童手当（差し引く）', -before.childBenefit, after ? -after.childBenefit : undefined],
    ['児童扶養手当（差し引く）', -before.singleParentBenefit, after ? -after.singleParentBenefit : undefined],
    ['改革案の追加給付（差し引く）', -before.reformCredit, after ? -after.reformCredit : undefined],
  ] as const;
  return <div className="grid gap-5 xl:grid-cols-2">
    <Card><CardHeader><h2 className="font-bold">選んだ年収の負担内訳</h2><p className="text-xs text-mirai-text-secondary">世帯年収 {yen(before.income)} ／ 年額・世帯単位</p></CardHeader>
      <CardContent><div className="overflow-x-auto"><table className="w-full text-sm tabular-nums">
        <thead><tr className="border-b border-mirai-border text-xs text-mirai-text-secondary"><th className="py-2 text-left" scope="col">項目</th><th className="text-right" scope="col">基準制度</th>{after && <th className="text-right" scope="col">改革案</th>}</tr></thead>
        <tbody>{rows.map(([label, base, updated]) => <tr key={label} className="border-b border-mirai-border/30"><th scope="row" className="py-2 pr-3 text-left text-xs font-normal">{label}</th><td className="whitespace-nowrap text-right">{yen(base)}</td>{after && <td className="whitespace-nowrap pl-3 text-right">{yen(updated ?? 0)}</td>}</tr>)}</tbody>
        <tfoot><tr className="font-bold"><th scope="row" className="pt-3 text-left">純負担額</th><td className="pt-3 text-right">{yen(before.netBurden)}</td>{after && <td className="pl-3 pt-3 text-right">{yen(after.netBurden)}</td>}</tr></tfoot>
      </table></div></CardContent>
    </Card>
    <Card><CardHeader><h2 className="font-bold">{impact ? '財政収支への影響' : 'この数字の読み方'}</h2><p className="text-xs text-mirai-text-secondary">{impact ? '選択世帯1件あたり・年額' : 'マクロの国民負担率とは分母が異なります'}</p></CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        {impact ? <>
          {impact.outOfScope && <p className="rounded-xl bg-mirai-surface p-3 font-medium">適用範囲外の参考計算です。財政推計の集計対象にはできません。</p>}
          <dl className="space-y-3 tabular-nums">{[
            ['国税収入差（所得税）', impact.incomeTax], ['地方税収入差（住民税）', impact.residentTax],
            ['本人保険料収入差', impact.insurance], ['給付支出差（＋は支出増）', impact.benefitSpending],
          ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-bold">{signed(Number(value))}</dd></div>)}</dl>
          <div className="rounded-xl bg-mirai-surface-teal p-4"><p className="text-xs">上記項目の収支差（収入差 − 給付支出差）</p><p className="mt-1 text-xl font-bold tabular-nums">{signed(impact.directBalance)}</p></div>
          <p className="text-xs text-mirai-text-secondary">消費税：未計算（支出データ未収録）。全国総額：未提供（対応する復元世帯数未確認）。行動変化・事業主負担は含めません。</p>
        </> : <>
          <p>純負担率は、世帯の税・本人保険料から現金給付を引き、給与年収で割った値です。負の値は、負担より給付が多いことを表します。</p>
          <p>財務省の国民負担率は、国・地方の税と事業主負担を含む社会保障負担を、国民所得で割った指標です。この曲線とは直接比較できません。</p>
          <div className="rounded-xl bg-mirai-surface-teal p-4"><p className="font-bold text-primary-accent">制度の違いを、条件を揃えて見る</p><p className="mt-2 text-xs">「改革案を比較」では控除や給付を変え、家計の変化と財政収支への影響を同時に確認できます。</p></div>
          <p className="text-xs text-mirai-text-secondary">本画面は試作です。OECD実出力との照合は未完了で、実際の納税額を確定する計算ではありません。</p>
        </>}
      </CardContent>
    </Card>
  </div>;
}
