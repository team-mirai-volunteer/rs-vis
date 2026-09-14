import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ConstraintResult } from '@/types/fiscal-space';
import { percent } from './format';

export function ConstraintMeters({ constraints }: { constraints: ConstraintResult[] }) {
  return <Card><CardHeader><h2 className="text-lg font-bold">現在の配分は、どの制約に近い？</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">評価期間中の最大利用率。100%は設定した閾値です。冒頭のカードは探索境界、こちらは入力中の総額の結果です。</p></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
    {constraints.map((r, i) => <div key={r.id} className="min-w-0 space-y-2">
      <div className="flex items-start justify-between gap-2 text-sm"><span className="font-bold">{r.label}{i === 0 ? '（最も近い）' : ''}</span><span className="shrink-0 tabular-nums">{percent(r.utilization, 1)}</span></div>
      <div role="meter" aria-label={`${r.label}の閾値利用率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, Number.isFinite(r.utilization) ? r.utilization * 100 : 100))} aria-valuetext={`${percent(r.utilization)}・${r.status === 'safe' ? '設定内' : '違反'}・年${r.year}`} className="h-2 overflow-hidden rounded-full bg-mirai-surface-warm">
        <div className={`h-full rounded-full ${r.status === 'violated' ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100, Math.max(0, r.utilization * 100))}%` }} />
      </div>
      <p className={`text-xs ${r.status === 'violated' ? 'text-stance-against' : 'text-mirai-text-subtle'}`}>年{r.year}・{r.status === 'safe' ? '設定内' : '閾値違反'}：実値{percent(r.currentValue)} / 閾値{percent(r.threshold)}</p>
      <details><summary className="cursor-pointer text-xs text-primary-accent">なぜ？ 計算根拠を見る</summary><p className="mt-2 text-xs leading-relaxed">{r.explanation}</p></details>
    </div>)}
  </CardContent></Card>;
}
