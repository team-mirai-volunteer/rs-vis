import { Card, CardContent } from '@/components/ui/card';
import type { FiscalSpaceEstimate } from '@/types/fiscal-space';
import { money, percent } from './format';

export function Summary({ estimate, horizon }: { estimate: FiscalSpaceEstimate; horizon: number }) {
  const capped = estimate.status === 'search-cap';
  const binding = estimate.status === 'boundary' || estimate.status === 'baseline-violated';
  const items = [
    { label: '推奨財政枠', en: 'Recommended Fiscal Envelope', value: money(estimate.recommendedEnvelope), note: capped ? '探索済み枠から留保を控除した暫定値' : 'この仮定内の年間追加枠（留保後）' },
    { label: '理論上限', en: 'Theoretical Maximum', value: `${capped ? '≥ ' : ''}${money(estimate.theoreticalMaximum)}`, note: capped ? '探索上限に到達・真の境界は未特定' : 'ゼロから連続する許容領域の近似境界' },
    { label: '緊急時留保', en: 'Emergency Reserve', value: money(estimate.emergencyReserve), note: `上限の${percent(estimate.reserveRule.share, 0)}を留保する簡易ルール` },
    { label: '最初に制約となるもの', en: 'Primary Binding Constraint', value: binding ? estimate.constraints[0]?.label : '未特定', note: binding ? `年${estimate.constraints[0]?.year}・${estimate.status === 'baseline-violated' ? '追加政策なしでも違反' : '境界の直後で最も厳しい制約'}` : '探索範囲内に制約の境界がありません' },
    { label: '次に近い制約', en: 'Secondary Constraint', value: binding ? estimate.constraints[1]?.label : '未特定', note: binding ? `年${estimate.constraints[1]?.year}・閾値利用率${percent(estimate.constraints[1]?.utilization)}` : '政策の配分・閾値を設定してください' },
  ];
  return <section aria-label="財政余力の探索結果" className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    {items.map(item => <Card key={item.en}><CardContent className="pt-5"><p className="text-sm font-bold">{item.label}</p><p className="mt-1 text-xs text-mirai-text-subtle">{item.en}</p><p className="mt-3 text-xl font-bold tabular-nums text-primary-accent">{item.value}</p><p className="mt-2 text-xs leading-relaxed text-mirai-text-subtle">{item.note}</p></CardContent></Card>)}
  </div><p className="text-xs leading-relaxed text-mirai-text-subtle">評価期間は年0〜{horizon}。政策の構成比と継続方法を固定し、年間追加総額を探索します。表示値は現在の総額への上乗せ額ではありません。すべて未校正の試作シナリオです。</p>
    {estimate.status === 'baseline-violated' && <p role="status" className="rounded-xl bg-stance-against-bg p-3 text-sm">追加政策なしの経路に既存の制約違反があるため、追加枠は0です。これは日本政府の支出能力が0という意味ではありません。経済状態・金利・閾値の仮定を確認してください。</p>}
  </section>;
}
