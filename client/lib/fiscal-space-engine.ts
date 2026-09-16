import { initialEconomy, POLICIES, TRILLION, assumptionRecords } from '@/app/lib/fiscal-space/assumptions';
import { REFERENCES, referenceRecords } from '@/app/lib/fiscal-space/calibration';
import { insuranceRevenueRecords, personalTaxRevenueRecords, policyReliefLimit } from '@/app/lib/fiscal-space/policy-limits';
import { simulate } from '@/app/lib/fiscal-space/simulate';
import { estimateFiscalSpace } from '@/app/lib/fiscal-space/search';
import { applyStressReserve } from '@/app/lib/fiscal-space/stress-envelope';
import { evaluateConstraints, peakConstraints, constraintInflation } from '@/app/lib/fiscal-space/constraints';
import { compareNextTrillion, rateShockComparison } from '@/app/lib/fiscal-space/compare';
import { PROJECT_POLICY_IDS, projectResponse } from '@/app/lib/fiscal-space/project-response';
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
import { estimatePolicyLoad, resourcePowerBalance, resourceRecords, validateResourceAssumptions } from '@/app/lib/fiscal-space/resource-estimate';

export const MODEL_LABELS = { leontief: 'レオンチェフ', ces: 'CES', cobbDouglas: 'コブ＝ダグラス' };
/** Optional evaluation horizon past the published years, so commissioning around year 11 (new nuclear) is visible. */
export const EXTENDED_HORIZON = 15;

/** One bounded cache per worker. It never stores a history of user scenarios. */
export function createFiscalEngine() {
  let cache: { key: string; singleSpaces: Map<string, FiscalSpaceEstimate> } | undefined;
  return (form: FiscalForm) => {
    validateResourceAssumptions(form.resource);
    const initial = initialEconomy(form.dataset);
    initial.production.inputs = { ...form.inputs };
    initial.macro.potentialGdp = initial.macro.realGdp / (1 + form.gap / 100);
    initial.macro.inflation = form.inflation / 100;
    initial.labour.sectorUtilization.construction = form.construction / 100;
    initial.energy.firmCapacity = form.firmCapacity;
    if (form.resource.mode === 'estimated') initial.energy.peakDemand = resourcePowerBalance(0, 0, 0, form.resource).nationalDemandGw;
    initial.energy.reserveMargin = (form.firmCapacity - initial.energy.peakDemand) / initial.energy.peakDemand;
    const p = { ...form.calibration, reserveShare: 0, resourceModel: form.resource };
    const publishedYears = REFERENCES[p.referenceModel].years;
    // 15 years is an explicit extension past the published multipliers (constant tail);
    // shorter horizons stay within the published years.
    const horizon = form.horizon === EXTENDED_HORIZON ? EXTENDED_HORIZON : Math.min(form.horizon, publishedYears);
    const simulationYears = Math.max(publishedYears, horizon);
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
    for (const policy of policyConfigs) policy.load ??= estimatePolicyLoad(policy, initial, form.resource);
    const policies = policyConfigs.map(policy => ({
      ...policy,
      annualCost: policyCostYen(policy.id, form.amounts[policy.id] ?? 0, p),
    }));
    const allocated = policies.filter(policy => policy.annualCost > 0);
    const mix = policies.map(policy => ({ policy, weight: policy.annualCost }));
    const totalYen = allocated.reduce((sum, policy) => sum + policy.annualCost, 0);
    const projection = simulate(initial, allocated, simulationYears, p, shock);
    const baseline = simulate(initial, [], simulationYears, p, shock);
    const generation = allocated.find(policy => policy.id === 'generation');
    const powerTimeline = generation ? projection.steps.slice(0, horizon).map((step, i) => {
      const base = baseline.steps[i];
      const energy = evaluateConstraints(step, form.thresholds).find(c => c.id === 'energy')!;
      const baseEnergy = evaluateConstraints(base, form.thresholds).find(c => c.id === 'energy')!;
      return { year: i + 1,
        generationSupplyGw: projectResponse(initial, generation, i + 1, p).firmGw,
        extraDemandGw: step.state.energy.peakDemand - base.state.energy.peakDemand,
        extraSupplyGw: step.state.energy.firmCapacity - base.state.energy.firmCapacity,
        utilization: energy.currentValue, baselineUtilization: baseEnergy.currentValue,
        region: step.resourcePower ? `${step.resourcePower.region}・${step.resourcePower.season}` : '全国',
      };
    }) : [];
    const inputExternal = fiscalExternal(initial, allocated, projection, baseline, p);
    const searched = estimateFiscalSpace(initial, mix, form.thresholds, horizon, p, shock);
    // The envelope is the amount that survives the selected stresses; the haircut is an output.
    const estimate = applyStressReserve(initial, mix, searched, form.thresholds, horizon, p, shock, form.stresses);
    const riskAudit = auditFiscalSpace(initial, mix, estimate, form.thresholds, horizon, p, shock);
    const constraints = peakConstraints({ ...projection, steps: projection.steps.slice(0, horizon) }, form.thresholds, p.inflationRule);
    const baselineConstraints = peakConstraints({ ...baseline, steps: baseline.steps.slice(0, horizon) }, form.thresholds, p.inflationRule);
    const probePolicies = totalYen > 0 ? allocated.map(policy => ({ ...policy,
      annualCost: policy.annualCost * (totalYen + TRILLION) / totalYen })) : [];
    const canProbe = probePolicies.length > 0 && probePolicies.every(policy =>
      policy.annualCost <= policyReliefLimit(policy.id, p));
    const sensitivity = constraintSensitivity({ ...projection, steps: projection.steps.slice(0, horizon) },
      canProbe ? simulate(initial, probePolicies, horizon, p, shock) : undefined, form.thresholds, p.inflationRule);
    const key = JSON.stringify([initial, policyConfigs, form.thresholds, horizon, p, shock]);
    if (cache?.key !== key) {
      cache = { key, singleSpaces: new Map(policyConfigs.map(policy => [policy.id,
        estimateFiscalSpace(initial, [{ policy, weight: 1 }], form.thresholds, horizon, p, shock)])) };
    }
    const spaces = cache.singleSpaces;
    const comparison = compareNextTrillion(initial, allocated, p, shock, form.thresholds, policies, horizon).map(row => {
      const space = spaces.get(row.policy.id);
      if (!space) throw new Error('Missing policy comparison');
      return { ...row, space };
    });
    const shocks = rateShockComparison(initial, allocated, p);
    const probeProjection = canProbe ? simulate(initial, probePolicies, simulationYears, p, shock) : undefined;
    const peaksByYear = projection.steps.map((step, i) => {
      if (!probeProjection) return '感応度未計算';
      const rows = constraintSensitivity({ initial: projection.initial, steps: [step] },
        { initial: probeProjection.initial, steps: [probeProjection.steps[i]] }, form.thresholds)
        .filter(r => !((r.id === 'sector' || r.id === 'energy') && step.coverage?.[r.id] === false))
        .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
      return !rows[0] || Math.abs(rows[0].delta ?? 0) < 1e-10 ? 'この配分では動かない' :
        evaluateConstraints(step, form.thresholds).find(c => c.id === rows[0].id)!.label;
    });
    const taxElasticitySensitivity = [...new Set([1, 1.1, 1.2, 1.3, 1.7, p.taxRevenueElasticity])].sort().map(elasticity => {
      const path = simulate(initial, allocated, horizon, { ...p, taxRevenueElasticity: elasticity }, shock);
      return { elasticity, debtGdp: path.steps[horizon - 1].metrics.grossDebtGdp, taxRevenue: path.steps[horizon - 1].state.fiscal.taxRevenue };
    });
    const modelSensitivity = Object.entries(MODEL_LABELS).map(([id, label]) => {
      const parameters = { ...p, productionModel: id as ModelParameters['productionModel'] };
      const path = simulate(initial, allocated, horizon, parameters, shock);
      const base = simulate(initial, [], horizon, parameters, shock);
      const last = path.steps[horizon - 1];
      return { label, initialMaximum: path.initial.production.maximum,
        potentialEffect: last.state.macro.potentialGdp - base.steps[horizon - 1].state.macro.potentialGdp,
        gdpEffect: last.state.macro.realGdp - base.steps[horizon - 1].state.macro.realGdp,
        cpiPeak: Math.max(...path.steps.map(constraintInflation)),
        capacityPriceAdjustment: last.demand.capacityPriceAdjustment,
        space: estimateFiscalSpace(initial, mix, form.thresholds, horizon, parameters, shock) };
    });
    const resourceSensitivity = form.resource.mode === 'estimated' ? [.5, 1, 1.5].map(loadScale => {
      const c = { ...form.resource, loadScale };
      const variants = policies.map(policy => ({ ...policy,
        load: form.loads[policy.id] ?? estimatePolicyLoad(policy, initial, c) }));
      const variantMix = variants.map(policy => ({ policy, weight: policy.annualCost }));
      const space = loadScale === form.resource.loadScale ? estimate
        : estimateFiscalSpace(initial, variantMix, form.thresholds, horizon, { ...p, resourceModel: c }, shock);
      return { loadScale, space };
    }) : [];
    const longRun = longRunScenario(initial, allocated, projection, baseline, p, form.longRun);
    const publicCapitalSensitivity = allocated.some(policy => policy.supply?.kind === 'capital' && policy.supply.realizationRate !== undefined)
      ? [0, .5, 1].map(overlap => {
        const variants = allocated.map(policy => policy.supply?.kind === 'capital'
          ? { ...policy, supply: { ...policy.supply, referenceOverlap: overlap } } : policy);
        const last = simulate(initial, variants, horizon, p, shock).steps[horizon - 1];
        return { overlap, benefit: last.publicCapital?.realizedBenefit ?? 0,
          gdpEffect: last.state.macro.realGdp - baseline.steps[horizon - 1].state.macro.realGdp };
      }) : [];
    const durationSensitivity = allocated.some(policy => policy.kind !== 'permanent')
      ? Array.from({ length: publishedYears }, (_, i) => i + 1).map(duration => {
        const variants = allocated.map(policy => policy.kind === 'permanent' ? policy : { ...policy, duration });
        const path = simulate(initial, variants, publishedYears, p, shock);
        const peak = path.steps.reduce((a, b) => constraintInflation(a) >= constraintInflation(b) ? a : b);
        return { duration, year: publishedYears,
          cost: path.steps.reduce((sum, step) => sum + step.policyCost, 0),
          gdpEffect: path.steps[publishedYears - 1].state.macro.realGdp - baseline.steps[publishedYears - 1].state.macro.realGdp,
          cpi: constraintInflation(peak), peakYear: peak.state.year,
        };
      }) : [];
    const records = [
      ...assumptionRecords({ initial, parameters: p, policies, thresholds: form.thresholds,
        shock, annualCost: totalYen, longRun: form.longRun }, '', form.dataset),
      ...referenceRecords(p.referenceModel), ...insuranceRevenueRecords(p), ...personalTaxRevenueRecords(), ...resourceRecords(form.resource, policies), ...Object.values(japanContext(form.dataset)), ...OECD_DEBT_RECORDS,
      ...burdenRecords(form.dataset === 'latest', form.corporateShare), ...externalStressRecords(),
      ...policyTradeRecords(form.trade), ...supplyRecords(form.supply),
    ];
    return { initial, p, horizon, policies, allocated, totalYen, projection, baseline, inputExternal,
      estimate, riskAudit, constraints, baselineConstraints, sensitivity, comparison, shocks, peaksByYear, taxElasticitySensitivity, powerTimeline,
      modelSensitivity, resourceSensitivity, publicCapitalSensitivity, longRun, durationSensitivity, records };
  };
}

export type FiscalCalculation = ReturnType<ReturnType<typeof createFiscalEngine>>;
export interface FiscalWorkerRequest { id: number; form: FiscalForm }
export type FiscalWorkerResponse = { id: number; ok: true; result: FiscalCalculation }
  | { id: number; ok: false; error: 'calculation' };
