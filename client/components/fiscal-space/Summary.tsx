import { Card, CardContent } from '@/components/ui/card';
import type { FiscalSpaceEstimate } from '@/types/fiscal-space';
import { money, percent } from './format';
import { CURRENT_BUDGET } from '@/app/lib/fiscal-space/budget';
import type { FiscalRiskAudit } from '@/app/lib/fiscal-space/risk-audit';
import { RiskAudit } from './RiskAudit';

export function Summary({ estimate, horizon, riskAudit }: { estimate: FiscalSpaceEstimate; horizon: number; riskAudit: FiscalRiskAudit }) {
  const capped = estimate.status === 'search-cap';
  const binding = estimate.status === 'boundary' || estimate.status === 'baseline-violated';
  const items = [
    { label: '限界財政枠', value: money(estimate.recommendedEnvelope), note: `理論上限から${percent(estimate.reserveRule.share, 0)}を留保した参考上限・安全性は未判定` },
    { label: '理論上限', value: `${capped ? '≥ ' : ''}${money(estimate.theoreticalMaximum)}`, note: capped ? '探索上限に到達・真の境界は未特定' : 'モデルの制約に達する留保前の計算上限' },
    { label: '緊急時留保', value: money(estimate.emergencyReserve), note: `上限の${percent(estimate.reserveRule.share, 0)}を留保する簡易ルール` },
    { label: '最初に制約となるもの', value: binding ? estimate.constraints[0]?.label : '未特定', note: binding ? `年${estimate.constraints[0]?.year}・${estimate.status === 'baseline-violated' ? '追加政策なしでも違反' : '境界の直後で最も厳しい制約'}` : '探索範囲内に制約の境界がありません' },
    { label: '次に近い制約', value: binding ? estimate.constraints[1]?.label : '未特定', note: binding ? `年${estimate.constraints[1]?.year}・閾値利用率${percent(estimate.constraints[1]?.utilization)}` : '政策の年額・閾値を設定してください' },
  ];
  return <section aria-label="財政余力の探索結果" className="space-y-3">
    <Card><CardContent className="space-y-3 pt-5">
      <h2 className="text-lg font-bold">今の予算と合わせると？</h2>
      <p className="rounded-xl bg-stance-against-bg p-3 text-sm"><strong>限界財政枠の安全性は未判定です。</strong> 設定した制約から算出した参考額です。公表モデルの為替反応を参考表示していますが、追加の円安ストレスや政策固有の供給効果は財政枠に織り込んでいません。この割合だけ予算を増やして大丈夫、という判定ではありません。</p>
      <div className="grid items-center gap-3 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div><p className="text-sm">現在の予算</p><p className="mt-1 text-2xl font-bold tabular-nums">{money(CURRENT_BUDGET.amount, 1)}</p><p className="mt-1 text-xs">{CURRENT_BUDGET.label}</p></div>
        <span aria-hidden="true" className="text-xl">＋</span>
        <div><p className="text-sm">限界財政枠（年間追加分）</p><p className="mt-1 text-2xl font-bold tabular-nums text-primary-accent">{money(estimate.recommendedEnvelope, 1)}</p><p className="mt-1 text-xs">現在の予算の{percent(estimate.recommendedEnvelope / CURRENT_BUDGET.amount, 1)}相当</p></div>
        <span aria-hidden="true" className="text-xl">＝</span>
        <div><p className="text-sm">合計の規模（減税を含む換算）</p><p data-testid="budget-combined" className="mt-1 text-2xl font-bold tabular-nums">{money(CURRENT_BUDGET.amount + estimate.recommendedEnvelope, 1)}</p><p className="mt-1 text-xs">留保を除いた追加枠を使用</p></div>
      </div>
      <p className="text-xs leading-relaxed text-mirai-text-subtle">追加枠をすべて国の一般会計で実施すると仮定した規模比較です。減税分は歳出に加わらないため、合計は成立予算や歳出総額の予測ではありません。余力の計算対象は地方・社会保障基金を含む一般政府で、一般会計の予算額は計算用の歳出に置き換えていません。<a className="text-primary-accent underline" href={CURRENT_BUDGET.sourceUrl} target="_blank" rel="noreferrer">予算の出典</a>（6月5日成立・9月14日確認）</p>
      {capped && <p className="text-xs">探索上限に達しているため、追加枠と合計は探索済み範囲の暫定値です。</p>}
      <RiskAudit audit={riskAudit} />
    </CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    {items.map(item => <Card key={item.label}><CardContent className="pt-5"><p className="text-sm font-bold">{item.label}</p><p className="mt-3 text-xl font-bold tabular-nums text-primary-accent">{item.value}</p><p className="mt-2 text-xs leading-relaxed text-mirai-text-subtle">{item.note}</p></CardContent></Card>)}
  </div><p className="text-xs leading-relaxed text-mirai-text-subtle">評価期間は年0〜{horizon}。入力した各政策の年額から構成比を計算し、継続方法を保って全体を拡大・縮小した場合の年間総額を探索します。限界財政枠は現在の合計への上乗せ額ではありません。選択したデータを初期状態とし、政策係数・将来経路・閾値は仮定です。</p>
    <p className="text-xs leading-relaxed text-mirai-text-subtle">政策の配分を変えると必要な労働・電力なども変わるため、追加枠が増える場合があります。財源の増加や財政収支の改善を意味するものではありません。</p>
    {estimate.status === 'baseline-violated' && <p role="status" className="rounded-xl bg-stance-against-bg p-3 text-sm">追加政策なしの経路に既存の制約違反があるため、追加枠は0です。これは日本政府の支出能力が0という意味ではありません。経済状態・金利・閾値の仮定を確認してください。</p>}
  </section>;
}
