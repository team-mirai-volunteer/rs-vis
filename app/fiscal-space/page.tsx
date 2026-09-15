'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS, TRILLION, assumptionRecords } from '@/app/lib/fiscal-space/assumptions';
import { estimateFiscalSpace } from '@/app/lib/fiscal-space/search';
import { simulate } from '@/app/lib/fiscal-space/simulate';
import { CONSTRAINTS, evaluateConstraints, peakConstraints } from '@/app/lib/fiscal-space/constraints';
import { compareNextTrillion, rateShockComparison } from '@/app/lib/fiscal-space/compare';
import { PROJECT_POLICY_IDS } from '@/app/lib/fiscal-space/project-response';
import { Controls } from '@/client/components/fiscal-space/Controls';
import { Summary } from '@/client/components/fiscal-space/Summary';
import { FiscalExternal } from '@/client/components/fiscal-space/FiscalExternal';
import { fiscalExternal } from '@/app/lib/fiscal-space/fiscal-external';
import { ConstraintMeters } from '@/client/components/fiscal-space/ConstraintMeters';
import { Comparison } from '@/client/components/fiscal-space/Comparison';
import { CapacityComparison, CurrentMetrics, Projection } from '@/client/components/fiscal-space/Projection';
import { Explanations, JapanBaseline } from '@/client/components/fiscal-space/Assumptions';
import { Calibration } from '@/client/components/fiscal-space/Calibration';
import { BurdenIndicators } from '@/client/components/fiscal-space/BurdenIndicators';
import { burdenRecords, CORPORATE_WAGE_SHARE } from '@/app/lib/fiscal-space/burden-data';
import { PolicyTrade, configuredPower, type TradeForm } from '@/client/components/fiscal-space/PolicyTrade';
import { PowerMix } from '@/client/components/fiscal-space/PowerMix';
import { ElectricityBaseline } from '@/client/components/fiscal-space/ElectricityBaseline';
import { INDUSTRY_CASE, powerCase, policyTradeRecords } from '@/app/lib/fiscal-space/policy-trade';
import { externalStressRecords } from '@/app/lib/fiscal-space/external-stress';
import { REFERENCES, referenceRecords } from '@/app/lib/fiscal-space/calibration';
import { SUPPLY_CASES, supplyRecords } from '@/app/lib/fiscal-space/supply';
import { SEMICONDUCTOR_CASE } from '@/app/lib/fiscal-space/policy-trade';
import { SupplyConditions } from '@/client/components/fiscal-space/SupplyConditions';
import { auditFiscalSpace } from '@/app/lib/fiscal-space/risk-audit';
import { japanContext, OECD_DEBT_RECORDS } from '@/app/lib/fiscal-space/japan-context';
import type { JapanDataset } from '@/app/lib/fiscal-space/japan-data';
import type { PolicyKind, Thresholds } from '@/types/fiscal-space';

const defaults = (dataset: JapanDataset = 'latest') => {
  const initial = initialEconomy(dataset);
  return { dataset, horizon: 5, corporateShare: CORPORATE_WAGE_SHARE,
  supply: Object.fromEntries(Object.entries(SUPPLY_CASES).map(([id, ref]) => [id, { ...ref.settings }])),
  trade: { selected: 'semiconductors', industry: Object.fromEntries(POLICIES.map(policy => [policy.id, { ...(policy.id === 'semiconductors' ? SEMICONDUCTOR_CASE : INDUSTRY_CASE) }])), power: powerCase('solar') } as TradeForm,
  policySettings: Object.fromEntries(POLICIES.map(policy => [policy.id, { kind: policy.kind, duration: policy.duration }])) as Record<string, { kind: PolicyKind; duration: number }>,
  rateShock: 0, energyShock: 0, reserve: PARAMETERS.reserveShare * 100,
  calibration: { ...PARAMETERS, hoursElasticity: .1, participationElasticity: .05 },
  gap: Number(((initial.macro.realGdp / initial.macro.potentialGdp - 1) * 100).toFixed(1)),
  inflation: initial.macro.inflation * 100,
  construction: initial.labour.sectorUtilization.construction * 100, firmCapacity: initial.energy.firmCapacity,
  amounts: { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 } as Record<string, number>, thresholds: { ...THRESHOLDS } };
};

export default function FiscalSpacePage() {
  const [form, setForm] = useState(() => defaults());
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm(f => ({ ...f, [key]: value }));
  const initial = useMemo(() => {
    const state = initialEconomy(form.dataset);
    state.macro.potentialGdp = state.macro.realGdp / (1 + form.gap / 100);
    state.macro.inflation = form.inflation / 100;
    state.labour.sectorUtilization.construction = form.construction / 100;
    state.energy.firmCapacity = form.firmCapacity;
    state.energy.reserveMargin = (form.firmCapacity - state.energy.peakDemand) / state.energy.peakDemand;
    return state;
  }, [form.dataset, form.gap, form.inflation, form.construction, form.firmCapacity]);
  const p = useMemo(() => ({ ...form.calibration, reserveShare: form.reserve / 100 }), [form.reserve, form.calibration]);
  const horizon = Math.min(form.horizon, REFERENCES[p.referenceModel].years);
  const shock = useMemo(() => ({ marketRateDelta: form.rateShock / 10000, energyPriceChange: form.energyShock / 100, realGrowthDelta: 0 }), [form.rateShock, form.energyShock]);
  const policies = useMemo(() => POLICIES.map(policy => ({ ...policy, ...form.policySettings[policy.id],
    annualCost: (form.amounts[policy.id] ?? 0) * TRILLION,
    supply: form.supply[policy.id],
    trade: policy.id === 'generation' ? { kind: 'power' as const, assumptions: configuredPower(form.trade) }
      : PROJECT_POLICY_IDS.includes(policy.id) ? { kind: 'industry' as const, assumptions: form.trade.industry[policy.id] } : undefined,
  })), [form.policySettings, form.amounts, form.trade, form.supply]);
  const totalYen = policies.reduce((sum, policy) => sum + policy.annualCost, 0);
  const total = totalYen / TRILLION;
  // Proportions are only used internally to estimate a limit for this policy composition.
  // The actual simulation uses the entered amounts directly, without reallocating them.
  const mix = useMemo(() => policies.map(policy => ({ policy, weight: policy.annualCost })), [policies]);
  const allocated = useMemo(() => policies.filter(policy => policy.annualCost > 0), [policies]);
  const projection = useMemo(() => simulate(initial, allocated, REFERENCES[p.referenceModel].years, p, shock), [initial, allocated, p, shock]);
  const baseline = useMemo(() => simulate(initial, [], REFERENCES[p.referenceModel].years, p, shock), [initial, p, shock]);
  const inputExternal = useMemo(() => fiscalExternal(initial, allocated, projection, baseline, p), [initial, allocated, projection, baseline, p]);
  const estimate = useMemo(() => estimateFiscalSpace(initial, mix, form.thresholds, horizon, p, shock), [initial, mix, form.thresholds, horizon, p, shock]);
  const riskAudit = useMemo(() => auditFiscalSpace(initial, mix, estimate, form.thresholds, horizon, p, shock), [initial, mix, estimate, form.thresholds, horizon, p, shock]);
  const constraints = useMemo(() => peakConstraints({ ...projection, steps: projection.steps.slice(0, horizon) }, form.thresholds), [projection, horizon, form.thresholds]);
  const singleSpaces = useMemo(() => policies.map(policy => estimateFiscalSpace(initial, [{ policy, weight: 1 }], form.thresholds, horizon, p, shock)), [initial, policies, form.thresholds, horizon, p, shock]);
  const comparison = useMemo(() => compareNextTrillion(initial, allocated, p, shock, form.thresholds, policies).map((r, i) => ({ ...r, space: singleSpaces[i] })), [initial, allocated, p, shock, form.thresholds, policies, singleSpaces]);
  const shocks = useMemo(() => rateShockComparison(initial, allocated, p), [initial, allocated, p]);
  const peaksByYear = useMemo(() => projection.steps.map(s => evaluateConstraints(s, form.thresholds).sort((a, b) => b.utilization - a.utilization)[0].label), [projection, form.thresholds]);
  const records = useMemo(() => [...assumptionRecords({ initial, parameters: p, policies, thresholds: form.thresholds, shock,
    annualCost: totalYen,
  }, '', form.dataset), ...referenceRecords(p.referenceModel), ...Object.values(japanContext(form.dataset)), ...OECD_DEBT_RECORDS, ...burdenRecords(form.dataset === 'latest', form.corporateShare), ...externalStressRecords(), ...policyTradeRecords(form.trade), ...supplyRecords(form.supply)], [initial, p, policies, form.thresholds, shock, totalYen, form.dataset, form.trade, form.corporateShare, form.supply]);
  const selected = projection.steps[horizon - 1];

  return <div className="min-h-screen bg-background text-mirai-text">
    <AppHeader current="/fiscal-space"><Button asChild variant="outline" size="sm"><a href="#model-notes"><Info />計算とデータについて</a></Button></AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-10 pt-5">
      <section className="rounded-2xl bg-mirai-gradient p-6 sm:p-8"><p className="mb-2 text-sm font-bold">財政余力を考える</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">次の1兆円で、何が最初に足りなくなる？</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed">財政余力シミュレータ（試作）。減税、公共投資、研究、エネルギー。使い道と期間を変えて、需要・物価・労働・輸入・借換のつながりを確かめます。</p></section>
      <JapanBaseline dataset={form.dataset} onDataset={dataset => setForm(f => {
        const base = defaults(dataset);
        return { ...f, dataset, gap: base.gap, inflation: base.inflation,
          construction: base.construction, firmCapacity: base.firmCapacity };
      })} />
      <Summary estimate={estimate} horizon={horizon} riskAudit={riskAudit} />
      <BurdenIndicators latest={form.dataset === 'latest'} corporateShare={form.corporateShare} onCorporateShare={value => update('corporateShare', value)} />
      <Calibration value={p} onChange={value => setForm(f => ({ ...f, calibration: { ...f.calibration, ...value }, horizon: Math.min(f.horizon, REFERENCES[value.referenceModel].years) }))} />
      <SupplyConditions value={form.supply} onChange={value => update('supply', value)} />
      <ElectricityBaseline value={p.electricity} onChange={electricity => setForm(f => ({ ...f, calibration: { ...f.calibration, electricity } }))} baseline={baseline} projection={projection} />
      <PowerMix value={form.trade} total={form.amounts.generation ?? 0} onChange={(trade, total) => setForm(f => ({ ...f, trade, amounts: { ...f.amounts, generation: total } }))} />
      <p role="status" aria-live="polite" className="sr-only">年間追加総額{total}兆円。最も近い制約は{constraints[0]?.label}。{constraints.some(c => c.status === 'violated') ? '閾値違反があります。' : '設定した閾値内です。'}</p>
      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Controls policies={policies} {...form} horizon={horizon} total={total} maxHorizon={REFERENCES[p.referenceModel].years} definitions={CONSTRAINTS}
          onAmount={(id, n) => setForm(f => ({ ...f, amounts: { ...f.amounts, [id]: n } }))}
          onHorizon={n => update('horizon', n)}
          onPolicyKind={(id, kind) => setForm(f => ({ ...f, policySettings: { ...f.policySettings, [id]: { ...f.policySettings[id], kind } } }))}
          onPolicyDuration={(id, duration) => setForm(f => ({ ...f, policySettings: { ...f.policySettings, [id]: { ...f.policySettings[id], duration } } }))}
          onRateShock={n => update('rateShock', n)} onEnergyShock={n => update('energyShock', n)} onReserve={n => update('reserve', n)}
          onThreshold={(id: keyof Thresholds, n) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, [id]: n } }))}
          onGap={n => update('gap', n)} onInflation={n => update('inflation', n)} onConstruction={n => update('construction', n)} onFirmCapacity={n => update('firmCapacity', n)} onReset={() => setForm(defaults(form.dataset))} />
        <div className="min-w-0 space-y-5">
          <ConstraintMeters constraints={constraints} />
          <CurrentMetrics step={selected} baseline={baseline.steps[horizon - 1]} publishedYears={REFERENCES[p.referenceModel].years} />
          <div className="rounded-xl border border-mirai-border bg-white p-4"><FiscalExternal rows={inputExternal} model={p.referenceModel} label={`入力中の政策 ${total.toFixed(1)}兆円 / 年`} /></div>
          <CapacityComparison initial={initial} production={projection.initial.production} />
        </div>
      </div>
      <Comparison rows={comparison} horizon={horizon} />
      <PolicyTrade policies={policies} value={form.trade} onChange={value => update('trade', value)} />
      <Projection simulation={projection} baseline={baseline} peaksByYear={peaksByYear} shocks={shocks} parameters={p} />
      <Explanations step={projection.steps[0]} parameters={p} policies={policies} records={records} />
    </main>
  </div>;
}
