import type { DemandResult, EconomyState, ModelParameters, Policy } from '@/types/fiscal-space';
import { clamp, productionCapacity } from './production';

/** All decomposition amounts are year-0-price yen. Policy costs are nominal yen. */
export function allocateDemand(state: EconomyState, policies: Policy[], p: ModelParameters, horizon = 1): DemandResult {
  const priceIndex = state.macro.nominalGdp / state.macro.realGdp;
  const maximum = productionCapacity(state, p, horizon).maximum;
  const gap = (state.macro.potentialGdp - state.macro.realGdp) / state.macro.potentialGdp;
  const slack = Math.max(0, (maximum - state.macro.realGdp) / maximum);
  const slackFactor = Math.max(0, 1 + p.gapMultiplierSensitivity * gap + p.slackMultiplierSensitivity * slack);
  const detail = policies.map(policy => {
    const sectorSlack = Math.max(0, 1 - state.labour.sectorUtilization[policy.sector]);
    const capacityFactor = clamp(Math.min(slack / p.supplySlackReference, sectorSlack / p.sectorSlackReference), p.minimumCapacityFactor);
    const domesticRetentionFactor = 1 - policy.importPropensity;
    const demand = policy.annualCost / priceIndex * policy.baseMultiplier * slackFactor;
    return { policyId: policy.id, cost: policy.annualCost, baseMultiplier: policy.baseMultiplier, slackFactor,
      capacityFactor, domesticRetentionFactor, demand, realOutput: demand * domesticRetentionFactor * capacityFactor };
  });
  const wanted = detail.reduce((s, d) => s + d.realOutput, 0);
  const scale = wanted > 0 ? Math.min(1, Math.max(0, maximum - state.macro.realGdp) / wanted) : 1;
  let additionalDemand = 0, realOutput = 0, imports = 0, prices = 0;
  const details = detail.map(d => {
    const real = d.realOutput * scale;
    const overflow = Math.max(0, d.demand * d.domesticRetentionFactor - real);
    additionalDemand += d.demand; realOutput += real;
    imports += d.demand * (1 - d.domesticRetentionFactor) + overflow * p.overflowImportShare;
    prices += overflow * (1 - p.overflowImportShare);
    return { ...d, capacityFactor: d.capacityFactor * scale, realOutput: real,
      effectiveMultiplier: d.cost > 0 ? real / (d.cost / priceIndex) : 0 };
  });
  return { additionalDemand, realOutput, imports, prices, details };
}
