import type { BurdenResult, FiscalImpact } from '@/types/tax-burden';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export const yen = (n: number) => `${(Math.round(n) || 0).toLocaleString('ja-JP')}円`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${yen(n)}`;

export function BurdenBreakdown({ before, after, impact, includeConsumption, pensionIncome, title }: {
  before: BurdenResult; after?: BurdenResult; impact?: FiscalImpact; includeConsumption: boolean; pensionIncome?: number; title?: string;
}) {
  const rows: (readonly [string, number, number | undefined])[] = [
    ['所得税（復興特別所得税込み）', before.incomeTax, after?.incomeTax],
    ['住民税（森林環境税込み）', before.residentTax, after?.residentTax],
    ['年金保険料・本人負担', before.pension, after?.pension],
    ['医療保険料・本人負担（健保／国保／後期）', before.health, after?.health],
    ['介護保険料・本人負担', before.care, after?.care],
    ['雇用保険・本人負担', before.employment, after?.employment],
    ...(includeConsumption ? [['消費税（推計）', before.consumptionTax, after?.consumptionTax] as const] : []),
    ...(before.corporateTax > 0 ? [['法人税の転嫁（仮定）', before.corporateTax, after?.corporateTax] as const] : []),
    ['児童手当（差し引く）', -before.childBenefit, after ? -after.childBenefit : undefined],
    ['児童扶養手当（差し引く）', -before.singleParentBenefit, after ? -after.singleParentBenefit : undefined],
    ['改革案の追加給付（差し引く）', -before.reformCredit, after ? -after.reformCredit : undefined],
    ...(pensionIncome !== undefined ? [['公的年金の受給（差し引く）', -pensionIncome, undefined] as const] : []),
  ];
  const total = (r: BurdenResult) => r.netBurden + (includeConsumption ? r.consumptionTax : 0) - (pensionIncome ?? 0);
  const qualifiers = [includeConsumption && '消費税込み', before.corporateTax > 0 && '法人税の転嫁込み',
    pensionIncome !== undefined && '年金差し引き'].filter((q): q is string => typeof q === 'string');
  return <div className="grid gap-5 xl:grid-cols-2">
    <Card><CardHeader><h2 className="font-bold">{title ?? '選んだ年収の負担内訳'}</h2><p className="text-xs text-mirai-text-secondary">総収入 {yen(before.income)}{pensionIncome ? `（うち公的年金 ${yen(pensionIncome)}）` : ''} ／ 年額・世帯単位{pensionIncome !== undefined ? '。年金は負担のマイナスとして差し引く' : ''}</p></CardHeader>
      <CardContent><div className="overflow-x-auto"><table className="w-full text-sm tabular-nums">
        <thead><tr className="border-b border-mirai-border text-xs text-mirai-text-secondary"><th className="py-2 text-left" scope="col">項目</th><th className="text-right" scope="col">基準制度</th>{after && <th className="text-right" scope="col">改革案</th>}</tr></thead>
        <tbody>{rows.map(([label, base, updated]) => <tr key={label} className="border-b border-mirai-border/30"><th scope="row" className="py-2 pr-3 text-left text-xs font-normal">{label}</th><td className="whitespace-nowrap text-right">{yen(base)}</td>{after && <td className="whitespace-nowrap pl-3 text-right">{yen(updated ?? 0)}</td>}</tr>)}</tbody>
        <tfoot><tr className="font-bold"><th scope="row" className="pt-3 text-left">純負担額{qualifiers.length ? `（${qualifiers.join('・')}）` : ''}</th><td className="pt-3 text-right">{yen(total(before))}</td>{after && <td className="pl-3 pt-3 text-right">{yen(total(after))}</td>}</tr></tfoot>
      </table></div></CardContent>
    </Card>
    <Card><CardHeader><h2 className="font-bold">{impact ? '財政収支への影響' : 'この数字の読み方'}</h2><p className="text-xs text-mirai-text-secondary">{impact ? '選択世帯1件あたり・年額' : 'マクロの国民負担率とは分母が異なります'}</p></CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        {impact ? <>
          {impact.outOfScope && <p className="rounded-xl bg-mirai-surface p-3 font-medium">適用範囲外の参考計算です。財政推計の集計対象にはできません。</p>}
          <dl className="space-y-3 tabular-nums">{([
            ['国税収入差（所得税）', impact.incomeTax], ['地方税収入差（住民税）', impact.residentTax],
            ['本人保険料収入差', impact.insurance], ['給付支出差（＋は支出増）', impact.benefitSpending],
            ...(impact.consumption.status === 'computed' ? [['国税収入差（消費税 7.8/10）', impact.consumption.national], ['地方税収入差（地方消費税 2.2/10）', impact.consumption.local]] as const : []),
          ] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-bold">{signed(Number(value))}</dd></div>)}</dl>
          <div className="rounded-xl bg-mirai-surface-teal p-4"><p className="text-xs">財政収支への影響（収入差 − 給付支出差{impact.consumption.status === 'computed' ? '、消費税込み' : ''}）</p><p className="mt-1 text-xl font-bold tabular-nums">{signed(impact.totalBalance ?? impact.directBalance)}</p></div>
          <p className="text-xs text-mirai-text-secondary">{impact.consumption.status === 'computed' ? '消費税差額は家計調査の十分位別支出構成からの推計。' : '消費税：未計算（消費支出データ未読込）。'}全国総額：未提供（対応する復元世帯数未確認）。行動変化・事業主負担は含めません。</p>
        </> : <>
          <p>純負担率は、世帯の税・本人保険料から現金給付を引き、総収入で割った値です。負の値は、負担より給付が多いことを表します。</p>
          <p>財務省の国民負担率は、国・地方の税と事業主負担を含む社会保障負担を、国民所得で割った指標です。この曲線とは直接比較できません。</p>
          <div className="rounded-xl bg-mirai-surface-teal p-4"><p className="font-bold text-primary-accent">制度の違いを、条件を揃えて見る</p><p className="mt-2 text-xs">「改革案を比較」では控除・給付・消費税率を変え、家計の変化と財政収支への影響を同時に確認できます。「年齢で見る」では年金受給後の負担率の変化を追えます。</p></div>
          <p className="text-xs text-mirai-text-secondary">本画面は試作です。OECD Taxing Wages の日本値との照合では、差はOECD側の保険料簡略化で説明できる範囲でした（詳細は「データについて」）。</p>
        </>}
      </CardContent>
    </Card>
  </div>;
}
