'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { SlidersHorizontal, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HOUSEHOLDS, BASE_REFORM, isReformed } from '@/app/lib/tax-burden/households';
import { wageIncidenceRate } from '@/app/lib/tax-burden/incidence';
import type { IncidenceDataset, TaxState } from '@/types/tax-burden';

/** Slider values are percentage points; round through integers so an untouched rate stays exactly equal to current law. */
const rate = (percent: number) => Math.round(percent * 1000) / 100000;

const inputClass = 'w-full rounded-xl border border-mirai-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function RangeField({ label, value, min, max, step = 1, suffix = '', onChange, disabled = false }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <label className="block space-y-1 text-sm">
    <span className="flex items-center justify-between gap-2"><span>{label}</span><span className="font-bold tabular-nums">{Number(value.toFixed(2)).toLocaleString('ja-JP')}{suffix}</span></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))}
      className="w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40" />
  </label>;
}

function Toggle({ label, note, checked, onChange, disabled = false }: { label: string; note?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="mt-1 accent-primary" />
    <span>{label}{note && <span className="block text-xs text-mirai-text-subtle">{note}</span>}</span>
  </label>;
}

export function TaxControls({ state, setState, hasConsumption, hasOecd, incidence }: {
  state: TaxState; setState: Dispatch<SetStateAction<TaxState>>; hasConsumption: boolean; hasOecd: boolean;
  incidence?: IncidenceDataset | null;
}) {
  // The curve view carries both the household scenario and the policy sliders. They swap in place so the chart stays on screen.
  const [tab, setTab] = useState<'household' | 'policy'>('household');
  const set = <K extends keyof TaxState>(key: K, value: TaxState[K]) => setState(s => ({ ...s, [key]: value }));
  const reform = <K extends keyof TaxState['reform']>(key: K, value: TaxState['reform'][K]) => setState(s => ({ ...s, reform: { ...s.reform, [key]: value } }));
  const household = HOUSEHOLDS.find(h => h.id === state.household)!;
  const swappable = state.view === 'curve' || state.view === 'age' || state.view === 'heatmap';
  const policy = swappable && tab === 'policy';
  const reformed = isReformed(state.reform);
  // The policy tab holds only the sliders, so it stays short enough to use while the chart is on screen.
  return <Card className="self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
    <CardHeader className="gap-3 pb-4">
      <h2 className="flex items-center gap-2 font-bold">{policy ? <><SlidersHorizontal className="size-4 text-primary-accent" />税・給付をいじる</> : <><Users className="size-4 text-primary-accent" />計算する世帯</>}</h2>
      {swappable && <div role="group" aria-label="左パネルの切替" className="flex gap-2">
        <Button size="sm" variant={tab === 'household' ? 'default' : 'outline'} aria-pressed={tab === 'household'} onClick={() => setTab('household')}>世帯</Button>
        <Button size="sm" variant={tab === 'policy' ? 'default' : 'outline'} aria-pressed={tab === 'policy'} onClick={() => setTab('policy')}>税・給付{reformed && '（変更中）'}</Button>
      </div>}
    </CardHeader>
    <CardContent className="space-y-4">
      {!policy && <>
        <label className="block space-y-2 text-sm"><span>制度モデル</span><select className={inputClass} value="2025" disabled aria-label="制度モデル"><option value="2025">2025年版（試作）</option></select></label>
        <label className="block space-y-2 text-sm"><span>家族構成</span><select className={inputClass} value={state.household} onChange={e => set('household', e.target.value as TaxState['household'])}>
          {HOUSEHOLDS.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select></label>
        {state.view !== 'heatmap' && <div className="space-y-2 rounded-xl bg-mirai-surface p-3">
          <RangeField label={state.view === 'age' ? '現役期の世帯年収' : '世帯年収'} value={state.income / 10000} min={0} max={2000} suffix="万円" onChange={v => set('income', Math.round(v * 10000))} />
          <label className="flex items-center justify-end gap-2 text-xs">年収を入力<input aria-label="世帯年収を万円で入力" type="number" min={0} max={2000} step={1} value={state.income / 10000}
            onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) set('income', Math.round(Math.max(0, Math.min(2000, n)) * 10000)); }}
            className="w-24 rounded-xl border border-mirai-border bg-card px-3 py-2 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />万円</label>
        </div>}
        {state.view === 'curve' && <RangeField label="大人の年齢" value={state.age} min={20} max={64} suffix="歳" onChange={v => set('age', v)} />}
        {household.earners === 2 && <RangeField label="第1就労者の収入割合" value={state.share} min={1} max={99} suffix="%" onChange={v => set('share', v)} />}
        <Toggle label="賞与2か月分を含める" note="月給12回＋1か月分を年2回" checked={state.bonus} onChange={v => set('bonus', v)} />
        {state.view === 'curve' && <>
          <Toggle label="6つの家族構成を重ねる" checked={state.showAll} onChange={v => set('showAll', v)} />
          <Toggle label="OECD平均・最小・最大を重ねる" note={hasOecd ? 'OECD Taxing Wages 2025。単身・片働きは平均賃金比50〜250%の連続系列、共働きは定点のみ' : 'OECDデータ未読込'} checked={state.showOecd} disabled={!hasOecd} onChange={v => set('showOecd', v)} />
        </>}
        {(state.view === 'age' || state.view === 'heatmap') && <section className="space-y-3 border-t border-mirai-border pt-4" aria-label="年齢軸の条件">
          <h3 className="font-bold text-primary-accent">働き方の前提</h3>
          <RangeField label="60歳以降の賃金（現役比）" value={Math.round(state.continuation * 100)} min={0} max={100} step={5} suffix="%" onChange={v => set('continuation', v / 100)} />
          <RangeField label="何歳まで働くか" value={state.workUntil} min={65} max={75} step={1} suffix="歳" onChange={v => set('workUntil', v)} />
          <p className="text-xs leading-relaxed text-mirai-text-subtle">{state.workUntil <= 65 ? '65歳で退職し、以後は年金のみ。' : `65〜${state.workUntil - 1}歳は年金を受けながら同じ賃金で働く（在職老齢年金の支給停止、70歳まで厚生年金保険料、75歳まで健康保険を適用）。`}家計調査では65〜69歳の勤労者世帯でも勤め先収入が月33万円あり、就労継続は珍しくありません。</p>
        </section>}
        <div className="rounded-xl bg-mirai-surface p-3 text-xs leading-relaxed text-mirai-text-secondary">給与所得のみ・正規被用者。子どもは大人32歳・34歳時に生まれ23歳で独立、大人は同年齢です。本人負担を計算します。</div>
      </>}

      {policy && <section className="space-y-3" aria-label="税・給付の条件">
        <p className="text-xs leading-relaxed text-mirai-text-secondary">{state.view === 'curve' ? '動かすと、基準制度のカーブに改革案のカーブ（太い破線）が重なります。'
          : state.view === 'age' ? '動かすと、基準制度の線（細い灰色）に改革案の線（破線）が重なります。'
          : '動かすと、税目ごとの表がその場で再計算されます。'}世帯の条件は「世帯」タブで変えられます。</p>
        <h3 className="pt-1 text-xs font-bold text-primary-accent">定率のものは料率で</h3>
        <RangeField label="住民税・所得割の税率" value={state.reform.localRate * 100} min={0} max={20} step={0.5} suffix="%" onChange={v => reform('localRate', rate(v))} />
        <RangeField label="年金保険料率（本人）" value={state.reform.pensionRate * 100} min={0} max={30} step={0.05} suffix="%" onChange={v => reform('pensionRate', rate(v))} />
        <RangeField label="医療保険料率（本人）" value={state.reform.healthRate * 100} min={0} max={20} step={0.05} suffix="%" onChange={v => reform('healthRate', rate(v))} />
        <RangeField label="介護保険料率（本人）" value={state.reform.careRate * 100} min={0} max={5} step={0.05} suffix="%" onChange={v => reform('careRate', rate(v))} />
        <RangeField label="雇用保険料率（本人）" value={state.reform.employmentRate * 100} min={0} max={5} step={0.05} suffix="%" onChange={v => reform('employmentRate', rate(v))} />
        <RangeField label="消費税・標準税率" value={Math.round(state.reform.standardVat * 100)} min={0} max={25} step={1} suffix="%" disabled={!hasConsumption}
          onChange={v => setState(s => ({ ...s, includeConsumption: true, reform: { ...s.reform, standardVat: rate(v) } }))} />
        <RangeField label="消費税・軽減税率" value={Math.round(state.reform.reducedVat * 100)} min={0} max={25} step={1} suffix="%" disabled={!hasConsumption}
          onChange={v => setState(s => ({ ...s, includeConsumption: true, reform: { ...s.reform, reducedVat: rate(v) } }))} />
        <h3 className="pt-2 text-xs font-bold text-primary-accent">累進の所得税は控除で</h3>
        <RangeField label="所得税の基礎控除を追加" value={state.reform.basicAllowanceExtra / 10000} min={0} max={200} step={5} suffix="万円" onChange={v => reform('basicAllowanceExtra', v * 10000)} />
        <h3 className="pt-2 text-xs font-bold text-primary-accent">給付を変える</h3>
        <RangeField label="児童手当・1人月額" value={state.reform.childMonthly} min={0} max={50000} step={1000} suffix="円" onChange={v => reform('childMonthly', v)} />
        <RangeField label="給付付き控除・世帯年額" value={state.reform.creditAnnual / 10000} min={0} max={100} step={5} suffix="万円" onChange={v => reform('creditAnnual', v * 10000)} />
        <RangeField label="給付の逓減開始年収" value={state.reform.creditPhaseoutStart / 10000} min={0} max={1000} step={50} suffix="万円" onChange={v => reform('creditPhaseoutStart', v * 10000)} />
        <RangeField label="給付の逓減率" value={state.reform.creditPhaseoutRate * 100} min={0} max={100} step={5} suffix="%" onChange={v => reform('creditPhaseoutRate', v / 100)} />
        <label className="block space-y-1 text-sm"><span>消費税を変えたときの前提</span>
          <select className={inputClass} value={state.consumptionAssumption} disabled={!hasConsumption} onChange={e => set('consumptionAssumption', e.target.value as TaxState['consumptionAssumption'])}>
            <option value="net-fixed">税抜の数量・価格を固定（税込支出が動く）</option>
            <option value="gross-fixed">税込支出を固定（実質消費が動く）</option>
          </select></label>
        <p className="text-xs leading-relaxed text-mirai-text-secondary">所得税は累進なので税率ではなく基礎控除で動かします。保険料率は本人負担分で、国民健康保険・後期高齢者医療・第1号介護保険料にも同じ比率で反映します（住民税の均等割と森林環境税は定額なので動きません）。給付付き控除は世帯単位の追加給付として試算し、世帯給与年収で逓減します。消費税率を動かすと消費税推計が自動で有効になります。</p>
        <Button variant="outline" size="sm" className="w-full" disabled={!reformed} onClick={() => set('reform', { ...BASE_REFORM })}><RotateCcw />基準制度に戻す</Button>
      </section>}

      {!policy && state.view !== 'heatmap' && <div className="border-t border-mirai-border pt-4">
        <Toggle label="消費税（推計）を含める" note={hasConsumption ? '家計調査2024年の年収十分位別支出から推計' : '消費支出データ未読込'} checked={state.includeConsumption} disabled={!hasConsumption} onChange={v => set('includeConsumption', v)} />
      </div>}
      {!policy && incidence && <section className="space-y-2 border-t border-mirai-border pt-4" aria-label="法人税の転嫁">
        <h3 className="font-bold text-primary-accent">法人税の転嫁（仮定）</h3>
        <RangeField label="賃金へ転嫁される割合" value={Math.round(state.corporateShare * 100)} min={0} max={100} step={1} suffix="%" onChange={v => set('corporateShare', v / 100)} />
        <p className="text-xs leading-relaxed text-mirai-text-subtle">{state.corporateShare > 0
          ? `法人所得課税${(incidence.corporateTaxTotal / 1e12).toFixed(1)}兆円（国税＋地方税・${incidence.metadata.year}年）の${Math.round(state.corporateShare * 100)}%を全国の賃金・俸給${(incidence.wagesAndSalaries / 1e12).toFixed(0)}兆円で割り、給与の${(wageIncidenceRate(incidence, state.corporateShare) * 100).toFixed(2)}%として上乗せしています。`
          : '法人税は企業が納めますが、一部は賃金の抑制を通じて働き手が負担しているという実証研究があります。0%のままなら計算に入れません。'}
          確立した値は無く、参考として{incidence.referenceShares.map(r => `${r.label}${Math.round(r.share * 100)}%`).join('、')}。日本を対象にした研究に基づく値ではありません。</p>
      </section>}
    </CardContent>
  </Card>;
}
