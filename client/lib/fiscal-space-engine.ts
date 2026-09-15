import { initialEconomy, POLICIES, TRILLION, assumptionRecords } from '@/app/lib/fiscal-space/assumptions';
import { REFERENCES, referenceRecords } from '@/app/lib/fiscal-space/calibration';
import { insuranceRevenueRecords, policyReliefLimit } from '@/app/lib/fiscal-space/policy-limits';
import { simulate } from '@/app/lib/fiscal-space/simulate';
import { estimateFiscalSpace } from '@/app/lib/fiscal-space/search';
import { evaluateConstraints, peakConstraints, constraintInflation } from '@/app/lib/fiscal-space/constraints';
import { compareNextTrillion, rateShockComparison } from '@/app/lib/fiscal-space/compare';
import { PROJECT_POLICY_IDS } from '@/app/lib/fiscal-space/project-response';
import { fiscalExternal } from '@/app/lib/fiscal-space/fiscal-external';
import { auditFiscalSpace } from '@/app/lib/fiscal-space/risk-audit';
import { longRunScenario } from '@/app/lib/fiscal-space/long-run';
import { japanContext, OECD_DEBT_RECORDS } from '@/app/lib/fiscal-space/japan-context';
import { burdenRecords } from '@/app/lib/fiscal-space/burden-data';
import { externalStressRecords } from '@/app/lib/fiscal-space/external-stress';
import { policyTradeRecords } from '@/app/lib/fiscal-space/policy-trade';
import { supplyRecords } from '@/app/lib/fiscal-space/supply';
import type { FiscalSpaceEstimate, ModelParameters } from '@/types/fiscal-space';
import type { FiscalForm } from './fiscal-space-form';
import { configuredPower } from './fiscal-space-trade';
import { policyCostYen } from './fiscal-space-amounts';
import { constraintSensitivity } from '@/app/lib/fiscal-space/constraint-sensitivity';

export const MODEL_LABELS = { leontief: 'レオンチェフ', ces: 'CES', cobbDouglas: 'コブ＝ダグラス' };

/** One bounded cache per worker. It never stores a history of user scenarios. */
export function createFiscalEngine() {
  let cache: { key: string; singleSpaces: Map<string, FiscalSpaceEstimate> } | undefined;
  return (form: FiscalForm) => {
    const initial = initialEconomy(form.dataset);
    initial.production.inputs = { ...form.inputs };
    initial.macro.potentialGdp = initial.macro.realGdp / (1 + form.gap / 100);
    initial.macro.inflation = form.inflation / 100;
    initial.labour.sectorUtilization.construction = form.construction / 100;
    initial.energy.firmCapacity = form.firmCapacity;
    initial.energy.reserveMargin = (form.firmCapacity - initial.energy.peakDemand) / initial.energy.peakDemand;
    const p = { ...form.calibration, reserveShare: form.reserve / 100 };
    const publishedYears = REFERENCES[p.referenceModel].years;
    const horizon = Math.min(form.horizon, publishedYears);
    const shock = {
      marketRateDelta: form.rateShock / 10000,
      energyPriceChange: form.energyShock / 100,
      realGrowthDelta: 0,
    };
    const policyConfigs = POLICIES.map(policy => ({
      ...policy, ...form.policySettings[policy.id], annualCost: TRILLION,
      load: form.loads[policy.id], supply: form.supply[policy.id],
      trade: policy.id === 'generation'
        ? { kind: 'power' as const, assumptions: configuredPower(form.trade) }
        : PROJECT_POLICY_IDS.includes(policy.id)
          ? { kind: 'industry' as const, assumptions: form.trade.industry[policy.id] } : undefined,
    }));
    const policies = policyConfigs.map(policy => ({
      ...policy,
      annualCost: policyCostYen(policy.id, form.amounts[policy.id] ?? 0, p),
    }));
    const allocated = policies.filter(policy => policy.annualCost > 0);
    const mix = policies.map(policy => ({ policy, weight: policy.annualCost }));
    const totalYen = allocated.reduce((sum, policy) => sum + policy.annualCost, 0);
    const projection = simulate(initial, allocated, publishedYears, p, shock);
    const baseline = simulate(initial, [], publishedYears, p, shock);
    const inputExternal = fiscalExternal(initial, allocated, projection, baseline, p);
    const estimate = estimateFiscalSpace(initial, mix, form.thresholds, horizon, p, shock);
    const riskAudit = auditFiscalSpace(initial, mix, estimate, form.thresholds, horizon, p, shock);
    const constraints = peakConstraints({ ...projection, steps: projection.steps.slice(0, horizon) }, form.thresholds);
    const baselineConstraints = peakConstraints({ ...baseline, steps: baseline.steps.slice(0, horizon) }, form.thresholds);
    const probePolicies = totalYen > 0 ? allocated.map(policy => ({ ...policy,
      annualCost: policy.annualCost * (totalYen + TRILLION) / totalYen })) : [];
    const canProbe = probePolicies.length > 0 && probePolicies.every(policy =>
      policy.annualCost <= policyReliefLimit(policy.id, p));
    const sensitivity = constraintSensitivity({ ...projection, steps: projection.steps.slice(0, horizon) },
      canProbe ? simulate(initial, probePolicies, horizon, p, shock) : undefined, form.thresholds);
    const key = JSON.stringify([initial, policyConfigs, form.thresholds, horizon, p, shock]);
    if (cache?.key !== key) {
      cache = { key, singleSpaces: new Map(policyConfigs.map(policy => [policy.id,
        estimateFiscalSpace(initial, [{ policy, weight: 1 }], form.thresholds, horizon, p, shock)])) };
    }
    const spaces = cache.singleSpaces;
    const comparison = compareNextTrillion(initial, allocated, p, shock, form.thresholds, policies).map(row => {
      const space = spaces.get(row.policy.id);
      if (!space) throw new Error('Missing policy comparison');
      return { ...row, space };
    });
    const shocks = rateShockComparison(initial, allocated, p);
    const peaksByYear = projection.steps.map(step => evaluateConstraints(step, form.thresholds)
      .sort((a, b) => b.utilization - a.utilization)[0].label);
    const modelSensitivity = Object.entries(MODEL_LABELS).map(([id, label]) => {
      const parameters = { ...p, productionModel: id as ModelParameters['productionModel'] };
      const path = simulate(initial, allocated, horizon, parameters, shock);
      const base = simulate(initial, [], horizon, parameters, shock);
      const last = path.steps[horizon - 1];
      return { label, initialMaximum: path.initial.production.maximum,
        potentialEffect: last.state.macro.potentialGdp - base.steps[horizon - 1].state.macro.potentialGdp,
        gdpEffect: last.state.macro.realGdp - base.steps[horizon - 1].state.macro.realGdp,
        cpiPeak: Math.max(...[path.initial, ...path.steps].map(constraintInflation)),
        capacityPriceAdjustment: last.demand.capacityPriceAdjustment,
        space: estimateFiscalSpace(initial, mix, form.thresholds, horizon, parameters, shock) };
    });
    const longRun = longRunScenario(initial, allocated, projection, baseline, p, form.longRun);
    const durationSensitivity = allocated.some(policy => policy.kind !== 'permanent')
      ? Array.from({ length: publishedYears }, (_, i) => i + 1).map(duration => {
        const variants = allocated.map(policy => policy.kind === 'permanent' ? policy : { ...policy, duration });
        const path = simulate(initial, variants, publishedYears, p, shock);
        const peak = [path.initial, ...path.steps].reduce((a, b) => constraintInflation(a) >= constraintInflation(b) ? a : b);
        return { duration, year: publishedYears,
          cost: path.steps.reduce((sum, step) => sum + step.policyCost, 0),
          gdpEffect: path.steps[publishedYears - 1].state.macro.realGdp - baseline.steps[publishedYears - 1].state.macro.realGdp,
          cpi: constraintInflation(peak), peakYear: peak.state.year,
        };
      }) : [];
    const records = [
      ...assumptionRecords({ initial, parameters: p, policies, thresholds: form.thresholds,
        shock, annualCost: totalYen, longRun: form.longRun }, '', form.dataset),
      ...referenceRecords(p.referenceModel), ...insuranceRevenueRecords(p), ...Object.values(japanContext(form.dataset)), ...OECD_DEBT_RECORDS,
      ...burdenRecords(form.dataset === 'latest', form.corporateShare), ...externalStressRecords(),
      ...policyTradeRecords(form.trade), ...supplyRecords(form.supply),
    ];
    return { initial, p, horizon, policies, allocated, totalYen, projection, baseline, inputExternal,
      estimate, riskAudit, constraints, baselineConstraints, sensitivity, comparison, shocks, peaksByYear,
      modelSensitivity, longRun, durationSensitivity, records };
  };
}

export type FiscalCalculation = ReturnType<ReturnType<typeof createFiscalEngine>>;
export interface FiscalWorkerRequest { id: number; form: FiscalForm }
export type FiscalWorkerResponse = { id: number; ok: true; result: FiscalCalculation }
  | { id: number; ok: false; error: 'calculation' };
