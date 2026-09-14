import { useId } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ConstraintDefinition, Policy, PolicyKind, Thresholds } from '@/types/fiscal-space';
import { fieldClass, KIND_LABELS, money } from './format';

export function RangeField({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  const id = useId();
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2"><label htmlFor={id} className="text-sm font-medium">{label}</label><span className="text-xs tabular-nums">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(e.target.valueAsNumber)} className="w-full accent-primary" />
  </div>;
}
export function Controls({ policies, weights, total, duration, mode, horizon, rateShock, energyShock, reserve, thresholds, definitions, gap, construction, firmCapacity,
  onWeight, onTotal, onDuration, onMode, onHorizon, onRateShock, onEnergyShock, onReserve, onThreshold, onGap, onConstruction, onFirmCapacity, onReset }: {
  policies: Policy[]; weights: Record<string, number>; total: number; duration: number; mode: 'preset' | PolicyKind; horizon: number;
  rateShock: number; energyShock: number; reserve: number; thresholds: Thresholds; definitions: ConstraintDefinition[];
  gap: number; construction: number; firmCapacity: number;
  onWeight: (id: string, n: number) => void; onTotal: (n: number) => void; onDuration: (n: number) => void;
  onMode: (v: 'preset' | PolicyKind) => void; onHorizon: (n: number) => void; onRateShock: (n: number) => void; onEnergyShock: (n: number) => void;
  onReserve: (n: number) => void; onThreshold: (id: keyof Thresholds, n: number) => void;
  onGap: (n: number) => void; onConstruction: (n: number) => void; onFirmCapacity: (n: number) => void; onReset: () => void;
}) {
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const primaryIds = ['social-insurance', 'rd', 'grid', 'defence', 'childcare', 'public-investment'];
  const policyField = (policy: Policy) => <div key={policy.id}>
    <RangeField label={policy.name} value={weights[policy.id] ?? 0} min={0} max={10} unit="" onChange={n => onWeight(policy.id, n)} />
    <p className="text-xs text-mirai-text-subtle">{money(weightTotal ? total * 1e12 * (weights[policy.id] ?? 0) / weightTotal : 0)} / 年・{KIND_LABELS[mode === 'preset' ? policy.kind : mode]}</p>
  </div>;
  return <Card><CardHeader><h2 className="text-lg font-bold">政策を組み合わせる</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">総額は年間の追加費用。配分の重みを動かすと、総額を保って他の政策の金額も変わります。</p></CardHeader>
    <CardContent className="space-y-5">
      <RangeField label="年間追加総額" value={total} min={0} max={100} step={.5} unit="兆円" onChange={onTotal} />
      <label className="block text-xs">総額を数値入力（兆円）<input className={`${fieldClass} mt-2`} type="number" min={0} max={100} step={.1} value={total} onChange={e => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) onTotal(Math.max(0, Math.min(100, v))); }} /></label>
      <label className="block space-y-2 text-sm"><span>政策の継続方法</span><select className={fieldClass} value={mode} onChange={e => onMode(e.target.value as typeof mode)}>
        <option value="preset">各政策のプリセット</option>{Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <RangeField label="支出期間（恒久政策を除く）" value={duration} min={1} max={10} unit="年" onChange={onDuration} />
      <div className="space-y-4 border-t border-mirai-border pt-4">
        {policies.filter(policy => primaryIds.includes(policy.id)).map(policyField)}
        <details><summary className="cursor-pointer text-sm font-bold">ほかの7政策を配分する</summary><div className="mt-4 space-y-4">{policies.filter(policy => !primaryIds.includes(policy.id)).map(policyField)}</div></details>
        {weightTotal === 0 && <p role="status" className="text-sm">配分がありません。政策の重みを1つ以上設定してください。</p>}
      </div>
      <details className="border-t border-mirai-border pt-4"><summary className="cursor-pointer text-sm font-bold">経済状態・評価条件を変える</summary><div className="mt-4 space-y-4">
        <RangeField label="潜在GDPギャップ（年0）" value={gap} min={-3} max={10} step={.5} unit="%" onChange={onGap} />
        <RangeField label="建設利用率（年0）" value={construction} min={70} max={100} unit="%" onChange={onConstruction} />
        <RangeField label="確実電力供給（年0）" value={firmCapacity} min={170} max={250} unit="GW" onChange={onFirmCapacity} />
        <label className="block space-y-2 text-sm"><span>制約の評価期間</span><select className={fieldClass} value={horizon} onChange={e => onHorizon(Number(e.target.value))}>{[1, 5, 10].map(n => <option key={n} value={n}>{n}年間</option>)}</select></label>
        <RangeField label="市場金利ショック" value={rateShock} min={0} max={300} step={100} unit="bp" onChange={onRateShock} />
        <RangeField label="輸入エネルギー価格ショック" value={energyShock} min={0} max={100} step={10} unit="%" onChange={onEnergyShock} />
        <RangeField label="緊急時留保率" value={reserve} min={0} max={50} step={5} unit="%" onChange={onReserve} />
        <p className="text-xs leading-relaxed">以下は政策判断のための仮の許容閾値です。科学的な危険ラインではありません。各指標がこの割合を超えると違反とします。</p>
        {definitions.map(d => <label key={d.id} className="block text-xs">{d.label} 上限（%）<input className={`${fieldClass} mt-1`} type="number" min={.01} step={.1} value={Number((thresholds[d.id] * 100).toFixed(3))} onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n) && n > 0) onThreshold(d.id, n / 100); }} /></label>)}
      </div></details>
      <Button variant="outline" className="w-full" onClick={onReset}>初期条件に戻す</Button>
    </CardContent>
  </Card>;
}
