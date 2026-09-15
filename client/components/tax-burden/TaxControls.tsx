'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { SlidersHorizontal, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { BIRTH_AGE_RANGE } from '@/app/lib/tax-burden/simulate';
import { WORK_UNTIL_MAX } from '@/app/lib/tax-burden/simulate-lifecycle';
import { HOUSEHOLDS, BASE_REFORM, isReformed } from '@/app/lib/tax-burden/households';
import { wageIncidenceRate } from '@/app/lib/tax-burden/incidence';
import type { IncidenceDataset, TaxState } from '@/types/tax-burden';

/** Slider values are percentage points; round through integers so an untouched rate stays exactly equal to current law. */
const rate = (percent: number) => Math.round(percent * 1000) / 100000;
/** Fractions are stored, percentages are shown; round so 0.08 does not surface as 8.000000000000002. */
const pct = (fraction: number) => Number((fraction * 100).toFixed(2));

const inputClass = 'w-full rounded-xl border border-mirai-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function RangeField({ label, value, min, max, step = 1, suffix = '', onChange, disabled = false, editable = false, note, onReset, resetDisabled }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string;
  onChange: (value: number) => void; disabled?: boolean; editable?: boolean; note?: string;
  onReset?: () => void; resetDisabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return <div className="space-y-1"><label className="block space-y-1 text-sm">
    <span className="flex items-center justify-between gap-2"><span>{label}</span>
      {editable
        ? <span className="flex shrink-0 items-center gap-1 font-bold tabular-nums">
            <input aria-label={`${label}・数値で入力`} type="number" min={min} max={max} step={step} value={Number(value.toFixed(2))} disabled={disabled}
              onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) onChange(clamp(n)); }}
              className="w-20 rounded-lg border border-mirai-border bg-card px-2 py-1 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40" />
            {suffix}</span>
        : <span className="font-bold tabular-nums">{Number(value.toFixed(2)).toLocaleString('ja-JP')}{suffix}</span>}
    </span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))}
      className="policy-range w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40" />
    {note && <span className="block text-xs text-mirai-text-subtle">{note}</span>}
  </label>{onReset && <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" aria-label={`${label}をリセット`} disabled={disabled || resetDisabled} onClick={onReset}><RotateCcw aria-hidden="true" />リセット</Button></div>}</div>;
}

function Toggle({ label, note, checked, onChange, disabled = false }: { label: string; note?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="mt-1 accent-primary" />
    <span>{label}{note && <span className="block text-xs text-mirai-text-subtle">{note}</span>}</span>
  </label>;
}

export function TaxControls({ state, setState, hasConsumption, hasOecd, incidence, basicAllowance, lifecycle }: {
  state: TaxState; setState: Dispatch<SetStateAction<TaxState>>; hasConsumption: boolean; hasOecd: boolean;
  incidence?: IncidenceDataset | null;
  /** Statutory basic deduction for the selected income, so the slider can show an amount instead of an offset. */
  basicAllowance?: number;
  /** Child spacing and the age they leave home, so the note can follow the birth-age slider. */
  lifecycle?: { childBirthAges: number[]; childLeavesAt: number };
}) {
  // The curve view carries both the household scenario and the policy sliders. They swap in place so the chart stays on screen.
  const [tab, setTab] = useState<'household' | 'policy'>('household');
  const set = <K extends keyof TaxState>(key: K, value: TaxState[K]) => setState(s => ({ ...s, [key]: value }));
  const reform = <K extends keyof TaxState['reform']>(key: K, value: TaxState['reform'][K]) => setState(s => ({ ...s, reform: { ...s.reform, [key]: value } }));
  const resetFields = (keys: (keyof TaxState['reform'])[]) => setState(s => {
    const next = { ...s.reform };
    for (const key of keys) next[key] = BASE_REFORM[key];
    return { ...s, reform: next };
  });
  const resetProps = (key: keyof TaxState['reform']) => ({ onReset: () => resetFields([key]), resetDisabled: state.reform[key] === BASE_REFORM[key] });
  const resetGroup = (label: string, keys: (keyof TaxState['reform'])[]) => <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" aria-label={`${label}をリセット`} disabled={keys.every(key => state.reform[key] === BASE_REFORM[key])} onClick={() => resetFields(keys)}><RotateCcw aria-hidden="true" />{label}をリセット</Button></div>;
  const household = HOUSEHOLDS.find(h => h.id === state.household)!;
  const swappable = state.view === 'curve' || state.view === 'age' || state.view === 'heatmap';
  const birthAges = [state.firstBirthAge, state.secondBirthAge].slice(0, household.children);
  const youngest = Math.max(...birthAges, 0);
  const lastBenefitAge = youngest + 18;
  const lastDependantAge = youngest + (lifecycle?.childLeavesAt ?? 23) - 1;
  const policy = swappable && tab === 'policy';
  const reformed = isReformed(state.reform);
  const allowance = basicAllowance ?? 580000;
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
        {(state.view === 'age' || state.view === 'heatmap') && household.children > 0 && <section className="space-y-3 border-t border-mirai-border pt-4" aria-label="子どもの前提">
          <h3 className="font-bold text-primary-accent">子どもの前提</h3>
          <RangeField label="第1子が生まれる親の年齢" value={state.firstBirthAge} min={BIRTH_AGE_RANGE[0]} max={BIRTH_AGE_RANGE[1]} suffix="歳"
            onChange={v => setState(st => ({ ...st, firstBirthAge: v, secondBirthAge: Math.max(v, st.secondBirthAge) }))} />
          {household.children > 1 && <RangeField label="第2子が生まれる親の年齢" value={state.secondBirthAge} min={state.firstBirthAge} max={BIRTH_AGE_RANGE[1]} suffix="歳"
            onChange={v => set('secondBirthAge', v)} />}
          <p className="text-xs leading-relaxed text-mirai-text-subtle">児童手当も扶養控除も子の年齢で決まるので、年齢軸のどこで給付・控除が切れるかは出産年齢の置き方で決まります。児童手当は末子が18歳以下の間（親{lastBenefitAge}歳まで）、扶養控除は末子が独立する{lifecycle?.childLeavesAt ?? 23}歳まで（親{lastDependantAge}歳まで）です。</p>
        </section>}
        {(state.view === 'age' || state.view === 'heatmap') && <section className="space-y-3 border-t border-mirai-border pt-4" aria-label="負担率の分母">
          <h3 className="font-bold text-primary-accent">負担率の分母</h3>
          <div role="group" aria-label="負担率の分母" className="flex gap-2">
            <Button size="sm" variant={state.denominator === 'income' ? 'default' : 'outline'} aria-pressed={state.denominator === 'income'} onClick={() => set('denominator', 'income')}>その年の総収入</Button>
            <Button size="sm" variant={state.denominator === 'career' ? 'default' : 'outline'} aria-pressed={state.denominator === 'career'} onClick={() => set('denominator', 'career')}>現役期の年収</Button>
          </div>
          <p className="text-xs leading-relaxed text-mirai-text-subtle">{state.denominator === 'income'
            ? 'その年に実際に受け取った額（給与＋年金）で割ります。ふつうの負担率の読み方ですが、年金が分母に入るので、受け取りが多いほど率は軽く見えます。'
            : 'どの年齢も現役期の世帯年収で割り、公的年金の受給は負担のマイナスとして扱います。同じ所得階層の人が生涯でどれだけ払い、どれだけ受け取るかを1つの尺度で見るための置き方です。'}</p>
        </section>}
        {(state.view === 'age' || state.view === 'heatmap') && <section className="space-y-3 border-t border-mirai-border pt-4" aria-label="年齢軸の条件">
          <h3 className="font-bold text-primary-accent">働き方の前提</h3>
          <RangeField label="60歳以降の賃金（現役比）" value={Math.round(state.continuation * 100)} min={0} max={100} step={5} suffix="%" onChange={v => set('continuation', v / 100)} />
          <RangeField label="何歳まで働くか" value={state.workUntil} min={65} max={WORK_UNTIL_MAX} step={1} suffix="歳" onChange={v => set('workUntil', v)} />
          <p className="text-xs leading-relaxed text-mirai-text-subtle">{state.workUntil <= 65 ? '65歳で退職し、以後は年金のみ。' : `65〜${state.workUntil - 1}歳は年金を受けながら同じ賃金で働く（在職老齢年金の支給停止。厚生年金保険料は70歳まで、健康保険は75歳までで、75歳以降は給与も含めた所得で後期高齢者医療の保険料がかかる。雇用保険は年齢の上限なし）。`}家計調査では65〜69歳の勤労者世帯でも勤め先収入が月33万円あり、就労継続は珍しくありません。</p>
        </section>}
        <div className="rounded-xl bg-mirai-surface p-3 text-xs leading-relaxed text-mirai-text-secondary">給与所得のみ・正規被用者。{household.children > 0 && `子どもは大人${birthAges.join('歳・')}歳時に生まれ${lifecycle?.childLeavesAt ?? 23}歳で独立、`}大人は同年齢です。本人負担を計算します。</div>
      </>}

      {policy && <section className="space-y-3" aria-label="税・給付の条件">
        <p className="text-xs leading-relaxed text-mirai-text-secondary">{state.view === 'curve' ? '動かすと、基準制度のカーブに改革案のカーブ（太い破線）が重なります。'
          : state.view === 'age' ? '動かすと、基準制度の線（細い灰色）に改革案の線（破線）が重なります。'
          : '動かすと、税目ごとの表がその場で再計算されます。'}世帯の条件は「世帯」タブで変えられます。</p>
        <Button variant="outline" size="sm" className="w-full" disabled={!reformed} onClick={() => set('reform', { ...BASE_REFORM })}><RotateCcw />基準制度に戻す</Button>
        <h3 className="pt-1 text-xs font-bold text-primary-accent">定率のものは料率で</h3>
        <RangeField editable {...resetProps('localRate')} label="住民税（所得割）" value={pct(state.reform.localRate)} min={0} max={20} step={0.5} suffix="%" onChange={v => reform('localRate', rate(v))} />
        <RangeField editable {...resetProps('pensionRate')} label="年金保険料率" value={pct(state.reform.pensionRate)} min={0} max={30} step={0.05} suffix="%" onChange={v => reform('pensionRate', rate(v))} />
        <RangeField editable {...resetProps('healthRate')} label="医療保険料率" value={pct(state.reform.healthRate)} min={0} max={20} step={0.05} suffix="%" onChange={v => reform('healthRate', rate(v))} />
        <RangeField editable {...resetProps('careRate')} label="介護保険料率" value={pct(state.reform.careRate)} min={0} max={5} step={0.05} suffix="%" onChange={v => reform('careRate', rate(v))} />
        <RangeField editable {...resetProps('employmentRate')} label="雇用保険料率" value={pct(state.reform.employmentRate)} min={0} max={5} step={0.05} suffix="%" onChange={v => reform('employmentRate', rate(v))} />
        <RangeField editable label="消費税・標準税率" value={pct(state.reform.standardVat)} min={0} max={25} step={0.5} suffix="%" disabled={!hasConsumption}
          onChange={v => setState(s => ({ ...s, includeConsumption: true, reform: { ...s.reform, standardVat: rate(v) } }))} />
        <RangeField editable label="消費税・軽減税率" value={pct(state.reform.reducedVat)} min={0} max={25} step={0.5} suffix="%" disabled={!hasConsumption}
          onChange={v => setState(s => ({ ...s, includeConsumption: true, reform: { ...s.reform, reducedVat: rate(v) } }))} />
        {resetGroup('消費税', ['standardVat', 'reducedVat'])}
        <h3 className="pt-2 text-xs font-bold text-primary-accent">累進の所得税は控除で</h3>
        <RangeField editable {...resetProps('basicAllowanceExtra')} label="所得税の基礎控除" value={(allowance + state.reform.basicAllowanceExtra) / 10000} min={0} max={(allowance + 2000000) / 10000} step={1} suffix="万円"
          note={`現行は所得に応じて58〜95万円（この年収では${(allowance / 10000).toLocaleString('ja-JP')}万円）。差額を全ての所得階層に足し引きします。`}
          onChange={v => reform('basicAllowanceExtra', Math.round(v * 10000) - allowance)} />
        <h3 className="pt-2 text-xs font-bold text-primary-accent">給付を変える</h3>
        <RangeField editable {...resetProps('childMonthly')} label="児童手当（月額）" value={state.reform.childMonthly} min={0} max={50000} step={1000} suffix="円" onChange={v => reform('childMonthly', Math.round(v))} />
        <RangeField editable label="給付付き控除（年額）" value={state.reform.creditAnnual / 10000} min={0} max={100} step={5} suffix="万円" onChange={v => reform('creditAnnual', Math.round(v * 10000))} />
        <RangeField editable label="逓減の開始年収" value={state.reform.creditPhaseoutStart / 10000} min={0} max={1000} step={50} suffix="万円" onChange={v => reform('creditPhaseoutStart', Math.round(v * 10000))} />
        <RangeField editable label="逓減率" value={pct(state.reform.creditPhaseoutRate)} min={0} max={100} step={5} suffix="%" onChange={v => reform('creditPhaseoutRate', rate(v))} />
        {resetGroup('給付付き控除', ['creditAnnual', 'creditPhaseoutStart', 'creditPhaseoutRate'])}
        <label className="block space-y-1 text-sm"><span>消費税を変えたときの前提</span>
          <select className={inputClass} value={state.consumptionAssumption} disabled={!hasConsumption} onChange={e => set('consumptionAssumption', e.target.value as TaxState['consumptionAssumption'])}>
            <option value="net-fixed">税抜の数量・価格を固定（税込支出が動く）</option>
            <option value="gross-fixed">税込支出を固定（実質消費が動く）</option>
          </select></label>
        <p className="text-xs leading-relaxed text-mirai-text-secondary">所得税は累進なので税率ではなく基礎控除で動かします。基礎控除は選択中の年収に適用される現行額を表示し、そこからの差額を全ての所得階層に足し引きします。保険料率は本人負担分で、国民健康保険・後期高齢者医療・第1号介護保険料にも同じ比率で反映します（住民税の均等割と森林環境税は定額なので動きません）。給付付き控除は世帯単位の追加給付として試算し、世帯給与年収で逓減します。消費税率を動かすと消費税推計が自動で有効になります。</p>
      </section>}

      {!policy && state.view !== 'heatmap' && <div className="border-t border-mirai-border pt-4">
        <Toggle label="消費税（推計）を含める" note={hasConsumption ? '家計調査2024年の年収十分位別支出から推計' : '消費支出データ未読込'} checked={state.includeConsumption} disabled={!hasConsumption} onChange={v => set('includeConsumption', v)} />
      </div>}
      {!policy && incidence && <section className="space-y-2 border-t border-mirai-border pt-4" aria-label="法人税の転嫁">
        <h3 className="font-bold text-primary-accent">法人税の転嫁（仮定）</h3>
        <RangeField label="賃金へ転嫁される割合" value={Math.round(state.corporateShare * 100)} min={0} max={100} step={1} suffix="%" onChange={v => set('corporateShare', v / 100)} />
        <p className="text-xs leading-relaxed text-mirai-text-subtle">{state.corporateShare > 0
          ? `法人所得課税${(incidence.corporateTaxTotal / 1e12).toFixed(1)}兆円（国税＋地方税・${incidence.metadata.year}年）の${Math.round(state.corporateShare * 100)}%を全国の賃金・俸給${(incidence.wagesAndSalaries / 1e12).toFixed(0)}兆円で割り、給与の${(wageIncidenceRate(incidence, state.corporateShare) * 100).toFixed(2)}%として上乗せしています。`
          : '法人税は企業が納めますが、一部は賃金の抑制を通じて働き手が負担しているという実証研究があります。0%なら計算に入れません。'}
          確立した値は無く、既定は25%です（土居2017の1年の帰着27%と、公的機関の分配分析の慣行18〜25%に合わせた保守的な置き方）。参考値は{incidence.referenceShares.map(r => `${r.label}${Math.round(r.share * 100)}%`).join('、')}。長期の推計はこれよりずっと大きく、日本の数字（土居）は動学的一般均衡モデルのシミュレーションで個票による実証推計ではありません。</p>
      </section>}
    </CardContent>
  </Card>;
}
