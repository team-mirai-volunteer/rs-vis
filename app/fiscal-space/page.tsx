'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS, TRILLION, assumptionRecords } from '@/app/lib/fiscal-space/assumptions';
import { allocateMix, estimateFiscalSpace } from '@/app/lib/fiscal-space/search';
import { simulate } from '@/app/lib/fiscal-space/simulate';
import { CONSTRAINTS, evaluateConstraints, peakConstraints } from '@/app/lib/fiscal-space/constraints';
import { compareNextTrillion, rateShockComparison } from '@/app/lib/fiscal-space/compare';
import { Controls } from '@/client/components/fiscal-space/Controls';
import { Summary } from '@/client/components/fiscal-space/Summary';
import { ConstraintMeters } from '@/client/components/fiscal-space/ConstraintMeters';
import { Comparison } from '@/client/components/fiscal-space/Comparison';
import { CapacityComparison, CurrentMetrics, Projection } from '@/client/components/fiscal-space/Projection';
import { Explanations } from '@/client/components/fiscal-space/Assumptions';
import type { PolicyKind, Thresholds } from '@/types/fiscal-space';

const defaults = () => ({ total: 10, duration: 3, mode: 'preset' as 'preset' | PolicyKind, horizon: 10,
  rateShock: 0, energyShock: 0, reserve: 20, gap: 2, construction: 94, firmCapacity: 200,
  weights: { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 } as Record<string, number>, thresholds: { ...THRESHOLDS } });

export default function FiscalSpacePage() {
  const [form, setForm] = useState(defaults);
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm(f => ({ ...f, [key]: value }));
  const initial = useMemo(() => {
    const state = initialEconomy();
    state.macro.potentialGdp = state.macro.realGdp / (1 - form.gap / 100);
    state.labour.sectorUtilization.construction = form.construction / 100;
    state.energy.firmCapacity = form.firmCapacity;
    state.energy.reserveMargin = (form.firmCapacity - state.energy.peakDemand) / state.energy.peakDemand;
    return state;
  }, [form.gap, form.construction, form.firmCapacity]);
  const p = useMemo(() => ({ ...PARAMETERS, reserveShare: form.reserve / 100 }), [form.reserve]);
  const shock = useMemo(() => ({ marketRateDelta: form.rateShock / 10000, energyPriceChange: form.energyShock / 100, realGrowthDelta: 0 }), [form.rateShock, form.energyShock]);
  const policies = useMemo(() => POLICIES.map(policy => ({ ...policy, duration: form.duration, kind: form.mode === 'preset' ? policy.kind : form.mode })), [form.duration, form.mode]);
  const mix = useMemo(() => policies.map(policy => ({ policy, weight: form.weights[policy.id] ?? 0 })), [policies, form.weights]);
  const allocated = useMemo(() => allocateMix(mix, form.total * TRILLION), [mix, form.total]);
  const projection = useMemo(() => simulate(initial, allocated, 10, p, shock), [initial, allocated, p, shock]);
  const baseline = useMemo(() => simulate(initial, [], 10, p, shock), [initial, p, shock]);
  const estimate = useMemo(() => estimateFiscalSpace(initial, mix, form.thresholds, form.horizon, p, shock), [initial, mix, form.thresholds, form.horizon, p, shock]);
  const constraints = useMemo(() => peakConstraints({ ...projection, steps: projection.steps.slice(0, form.horizon) }, form.thresholds), [projection, form.horizon, form.thresholds]);
  const singleSpaces = useMemo(() => policies.map(policy => estimateFiscalSpace(initial, [{ policy, weight: 1 }], form.thresholds, form.horizon, p, shock)), [initial, policies, form.thresholds, form.horizon, p, shock]);
  const comparison = useMemo(() => compareNextTrillion(initial, allocated, p, shock, form.thresholds, policies).map((r, i) => ({ ...r, space: singleSpaces[i] })), [initial, allocated, p, shock, form.thresholds, policies, singleSpaces]);
  const shocks = useMemo(() => rateShockComparison(initial, allocated, p), [initial, allocated, p]);
  const peaksByYear = useMemo(() => projection.steps.map(s => evaluateConstraints(s, form.thresholds).sort((a, b) => b.utilization - a.utilization)[0].label), [projection, form.thresholds]);
  const records = useMemo(() => assumptionRecords({ initial, parameters: p, policies, thresholds: form.thresholds, shock,
    annualCost: form.total * TRILLION, allocationWeights: form.weights,
  }), [initial, p, policies, form.thresholds, shock, form.total, form.weights]);
  const selected = projection.steps[form.horizon - 1];

  return <div className="min-h-screen bg-background text-mirai-text">
    <AppHeader current="/fiscal-space"><Button asChild variant="outline" size="sm"><a href="#model-notes"><Info />計算とデータについて</a></Button></AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-10 pt-5">
      <section className="rounded-2xl bg-mirai-gradient p-6 sm:p-8"><p className="mb-2 text-sm font-bold">財政余力を考える</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">次の1兆円で、何が最初に足りなくなる？</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed">財政余力シミュレータ。減税、公共投資、研究、エネルギー。使い道と期間を変えて、需要・物価・労働・輸入・借換のつながりを確かめます。</p></section>
      <div className="rounded-xl border border-mirai-border bg-card p-4 text-sm leading-relaxed"><strong className="mr-2 rounded-full bg-mirai-surface-teal px-3 py-1 text-primary-accent">試作・全入力が仮定</strong>日本の実測値で校正していないモデル実験です。表示額は現在の日本政府の支出可能額ではありません。政策や閾値を変えたときの違いを比較してください。</div>
      <Summary estimate={estimate} horizon={form.horizon} />
      <p role="status" aria-live="polite" className="sr-only">年間追加総額{form.total}兆円。最も近い制約は{constraints[0]?.label}。{constraints.some(c => c.status === 'violated') ? '閾値違反があります。' : '設定した閾値内です。'}</p>
      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Controls policies={POLICIES} {...form} definitions={CONSTRAINTS}
          onWeight={(id, n) => setForm(f => ({ ...f, weights: { ...f.weights, [id]: n } }))}
          onTotal={n => update('total', n)} onDuration={n => update('duration', n)} onMode={v => update('mode', v)} onHorizon={n => update('horizon', n)}
          onRateShock={n => update('rateShock', n)} onEnergyShock={n => update('energyShock', n)} onReserve={n => update('reserve', n)}
          onThreshold={(id: keyof Thresholds, n) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, [id]: n } }))}
          onGap={n => update('gap', n)} onConstruction={n => update('construction', n)} onFirmCapacity={n => update('firmCapacity', n)} onReset={() => setForm(defaults())} />
        <div className="min-w-0 space-y-5">
          <ConstraintMeters constraints={constraints} />
          <CurrentMetrics step={selected} baseline={baseline.steps[form.horizon - 1]} />
          <CapacityComparison initial={initial} production={projection.initial.production} />
        </div>
      </div>
      <Comparison rows={comparison} horizon={form.horizon} />
      <Projection simulation={projection} baseline={baseline} peaksByYear={peaksByYear} shocks={shocks} parameters={p} />
      <Explanations step={projection.steps[0]} parameters={p} policies={policies} records={records} />
    </main>
  </div>;
}
