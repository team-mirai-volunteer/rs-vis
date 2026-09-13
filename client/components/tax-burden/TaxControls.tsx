'use client';

import type { Dispatch, SetStateAction } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HOUSEHOLDS, BASE_REFORM } from '@/app/lib/tax-burden/households';
import type { TaxState } from '@/types/tax-burden';

const inputClass = 'w-full rounded-xl border border-mirai-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function RangeField({ label, value, min, max, step = 1, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  return <label className="block space-y-2 text-sm">
    <span className="flex items-center justify-between gap-2"><span>{label}</span><span className="font-bold tabular-nums">{Number(value.toFixed(2)).toLocaleString('ja-JP')}{suffix}</span></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
      className="w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
  </label>;
}

export function TaxControls({ state, setState }: { state: TaxState; setState: Dispatch<SetStateAction<TaxState>> }) {
  const set = <K extends keyof TaxState>(key: K, value: TaxState[K]) => setState(s => ({ ...s, [key]: value }));
  const reform = <K extends keyof TaxState['reform']>(key: K, value: TaxState['reform'][K]) => setState(s => ({ ...s, reform: { ...s.reform, [key]: value } }));
  const household = HOUSEHOLDS.find(h => h.id === state.household)!;
  return <Card className="self-start lg:sticky lg:top-4">
    <CardHeader className="pb-4"><h2 className="flex items-center gap-2 font-bold"><SlidersHorizontal className="size-4 text-primary-accent" />計算する世帯</h2></CardHeader>
    <CardContent className="space-y-5">
      <label className="block space-y-2 text-sm"><span>制度モデル</span><select className={inputClass} value="2025" disabled aria-label="制度モデル"><option value="2025">2025年版（試作）</option></select></label>
      <label className="block space-y-2 text-sm"><span>家族構成</span><select className={inputClass} value={state.household} onChange={e => set('household', e.target.value as TaxState['household'])}>
        {HOUSEHOLDS.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
      </select></label>
      <RangeField label="大人の年齢" value={state.age} min={20} max={64} suffix="歳" onChange={v => set('age', v)} />
      {household.earners === 2 && <RangeField label="第1就労者の収入割合" value={state.share} min={1} max={99} suffix="%" onChange={v => set('share', v)} />}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={state.bonus} onChange={e => set('bonus', e.target.checked)} className="mt-1 accent-primary" /><span>賞与2か月分を含める<span className="block text-xs text-mirai-text-subtle">月給12回＋1か月分を年2回</span></span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={state.showAll} onChange={e => set('showAll', e.target.checked)} className="mt-1 accent-primary" />6つの家族構成を重ねる</label>
      <div className="rounded-xl bg-mirai-surface p-3 text-xs leading-relaxed text-mirai-text-secondary">給与所得のみ・正規被用者。子どもは6歳・8歳、大人は同年齢です。本人負担を計算します。</div>
      {state.view === 'reform' && <section className="space-y-5 border-t border-mirai-border pt-5" aria-label="改革案の条件">
        <h2 className="font-bold text-primary-accent">改革案をつくる</h2>
        <RangeField label="所得税の基礎控除を追加" value={state.reform.basicAllowanceExtra / 10000} min={0} max={200} step={5} suffix="万円" onChange={v => reform('basicAllowanceExtra', v * 10000)} />
        <RangeField label="本人保険料の倍率" value={state.reform.insuranceMultiplier * 100} min={0} max={200} step={5} suffix="%" onChange={v => reform('insuranceMultiplier', v / 100)} />
        <RangeField label="児童手当・1人月額" value={state.reform.childMonthly} min={0} max={50000} step={1000} suffix="円" onChange={v => reform('childMonthly', v)} />
        <RangeField label="給付付き控除・世帯年額" value={state.reform.creditAnnual / 10000} min={0} max={100} step={5} suffix="万円" onChange={v => reform('creditAnnual', v * 10000)} />
        <RangeField label="給付の逓減開始年収" value={state.reform.creditPhaseoutStart / 10000} min={0} max={1000} step={50} suffix="万円" onChange={v => reform('creditPhaseoutStart', v * 10000)} />
        <RangeField label="給付の逓減率" value={state.reform.creditPhaseoutRate * 100} min={0} max={100} step={5} suffix="%" onChange={v => reform('creditPhaseoutRate', v / 100)} />
        <p className="text-xs leading-relaxed text-mirai-text-secondary">給付付き控除は世帯単位の追加給付として試算し、世帯給与年収で逓減します。消費税率の変更は支出データの収録後に提供します。</p>
        <Button variant="outline" size="sm" className="w-full" onClick={() => set('reform', { ...BASE_REFORM })}><RotateCcw />改革案をリセットする</Button>
      </section>}
    </CardContent>
  </Card>;
}
