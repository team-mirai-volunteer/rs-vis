import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ConstraintResult } from '@/types/fiscal-space';
import { percent, points } from './format';

export function ConstraintMeters({ constraints, baseline = [] }: {
  constraints: ConstraintResult[]; baseline?: ConstraintResult[];
}) {
  const evaluated = constraints.filter(r => r.status !== 'unevaluated').sort((a, b) => b.utilization - a.utilization);
  const unknown = constraints.filter(r => r.status === 'unevaluated');
  return <Card><CardHeader>
    <h2 className="text-lg font-bold">現在の配分は、どの制約に近い？</h2>
    <p className="text-sm">入力額の評価結果。縦線100%が設定した上限です。80%以上は「上限に近い」と表示しますが、危険確率ではありません。</p>
  </CardHeader><CardContent className="space-y-4">
    {evaluated.map(r => {
      const label = r.status === 'violated' ? '閾値違反' : r.utilization >= .8 ? '上限に近い・設定内' : '設定内';
      const base = baseline.find(b => b.id === r.id);
      return <div key={r.id} className="space-y-1">
        <div className="flex justify-between gap-2 text-sm"><strong>{r.label}</strong><span>{percent(r.utilization, 1)}・{label}</span></div>
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
        <details><summary className="cursor-pointer text-sm text-primary-accent">なぜ？ 計算根拠を見る</summary><p className="mt-2 text-sm">{r.explanation}</p></details>
      </div>;
    })}
    {unknown.length > 0 && <div className="space-y-2 border-t border-mirai-border pt-3">
      <h3 className="font-bold">追加負荷を評価できていない制約</h3>
      {unknown.map(r => <p key={r.id} className="text-sm"><strong>{r.label}：未評価。</strong>負荷係数が不足しており、「設定内」とは判定できません。政策別の負荷条件で原単位を指定できます。</p>)}
    </div>}
  </CardContent></Card>;
}
