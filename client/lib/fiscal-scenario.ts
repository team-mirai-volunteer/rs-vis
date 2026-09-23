import { initialEconomy, POLICIES, TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { PROJECT_POLICY_IDS } from '@/app/lib/fiscal-space/project-response';
import { estimatePolicyLoad, resourcePowerBalance, validateResourceAssumptions } from '@/app/lib/fiscal-space/resource-estimate';
import { calibrateCapacity } from '@/app/lib/fiscal-space/capacity-calibration';
import { validatePoverty } from '@/app/lib/fiscal-space/poverty';
import { configuredPower } from './fiscal-space-trade';
import { policyCostYen } from './fiscal-space-amounts';
import type { FiscalForm } from './fiscal-space-form';

export const EXTENDED_HORIZON = 15;

/** Shared setup for displayed projections and optimization candidates. */
export function prepareFiscalScenario(form: FiscalForm) {
  validateResourceAssumptions(form.resource);
  validatePoverty(form.poverty);
  const initial = initialEconomy(form.dataset);
  initial.production.inputs = calibrateCapacity(form.capacity, form.inputs, 1 + form.gap / 100).inputs;
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
  return { initial, p, horizon, simulationYears, shock, policyConfigs, policies, allocated, mix, totalYen };
}
