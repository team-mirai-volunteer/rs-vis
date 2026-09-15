import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ConstraintResult } from '@/types/fiscal-space';
import { percent, points } from './format';
import { FiscalVintageBadge } from './ResultAssumptions';

export function ConstraintMeters({ constraints, baseline = [], sensitivity, latest }: {
  constraints: ConstraintResult[]; baseline?: ConstraintResult[];
  sensitivity: { id: string; delta: number | null }[];
  latest: boolean;
}) {
  const delta = (id: string) => sensitivity.find(s => s.id === id)?.delta ?? null;
  const incomplete = (r: ConstraintResult) => r.coverageComplete === false || r.status === 'unevaluated';
  const evaluated = constraints.filter(r => !incomplete(r)).sort((a, b) => (delta(b.id) ?? -Infinity) - (delta(a.id) ?? -Infinity));
  const unknown = constraints.filter(incomplete);
  return <Card><CardHeader>
    <h2 className="text-lg font-bold">次の1兆円で、どの制約が動く？</h2>
    <p className="text-sm">同じ配分・期間で年額を1兆円増やしたときの、期間内ピーク利用率の変化が大きい順です。境界までの金額や厳密な微分ではありません。バーは現在の水準、縦線100%は設定上限で、危険確率ではありません。</p>
    <p className="text-xs">年0がピークの制約は、将来年が変化しても差が0になる場合があります。配分未入力・消費税や社会保険料の軽減限度にかかる場合は感応度を計算できません。</p>
  </CardHeader><CardContent className="space-y-4">
    {evaluated.map(r => {
      const label = r.status === 'violated' ? '閾値違反' : r.utilization >= .8 ? '上限に近い・設定内' : '設定内';
      const base = baseline.find(b => b.id === r.id);
      const change = delta(r.id);
      return <div key={r.id} className="space-y-1" data-constraint={r.id}>
        <div className="flex justify-between gap-2 text-sm"><strong>{r.label}</strong><span>{percent(r.utilization, 1)}・{label}</span></div>
        <p className="text-sm font-medium">{change === null ? '追加1兆円の感応度：未計算' : Math.abs(change) < 1e-10
          ? '追加1兆円：ピーク利用率はこの配分では動かない'
          : `追加1兆円：${points(change)} / 兆円${Math.abs(change) < .000005 ? '（表示桁未満の変化）' : ''}`}</p>
        <div role="meter" aria-label={`${r.label}の閾値利用率`} aria-valuemin={0} aria-valuemax={120}
          aria-valuenow={Math.min(120, Math.max(0, Number.isFinite(r.utilization) ? r.utilization * 100 : 120))}
          aria-valuetext={`${percent(r.utilization)}・${label}・年${r.year}`}
          className="relative h-3 bg-mirai-surface-warm">
          <div className={`h-full ${r.status === 'violated' ? 'bg-destructive' : r.utilization >= .8 ? 'bg-amber-600' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, Math.max(0, r.utilization / 1.2 * 100))}%` }} />
          <span aria-hidden="true" className="absolute top-0 h-3 border-l-2 border-mirai-text" style={{ left: `${100 / 1.2}%` }} />
        </div>
        <p className="text-sm">年{r.year}・計算値{percent(r.currentValue)} / 閾値{percent(r.threshold)}。
          {base && ` 政策なしのピークとの差 ${points(r.utilization - base.utilization)}。`}
          {r.year === 0 && ' ピークは政策実施前です。将来の変化がないという意味ではありません。'}
        </p>
        {['debt', 'interestGdp', 'gfn'].includes(r.id) && <FiscalVintageBadge latest={latest} projected={r.year > 0} />}
        <details><summary className="cursor-pointer text-sm text-primary-accent">なぜ？ 計算根拠を見る</summary><p className="mt-2 text-sm">{r.explanation}</p></details>
      </div>;
    })}
    {unknown.length > 0 && <div className="space-y-2 border-t border-mirai-border pt-3">
      <h3 className="font-bold">追加負荷を評価できていない制約</h3>
      {unknown.map(r => <p key={r.id} className="text-sm" data-constraint={r.id}><strong>{r.label}：追加負荷は未評価。</strong>{r.status === 'violated' && `既知の負荷だけでも閾値違反（年${r.year}）。`}負荷係数が不足しており、余裕や感応度は判定できません。政策別の負荷条件で原単位を指定できます。</p>)}
    </div>}
  </CardContent></Card>;
}
