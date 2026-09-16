import type { DemandResult, EconomyState, ModelParameters, Policy } from '@/types/fiscal-space';
import { calibratedResponse } from './calibration';
import { productionCapacity } from './production';
import { adjustedResponse, projectResponses, projectNetOutput } from './project-response';

/** All decomposition amounts are year-0-price yen. Policy costs are nominal yen. */
export function allocateDemand(state: EconomyState, policies: Policy[], p: ModelParameters, horizon = 1, initial = state,
  baseline = { real: initial.macro.realGdp * (1 + p.baselineRealGrowth) ** horizon, potential: initial.macro.potentialGdp * (1 + p.baselineRealGrowth) ** horizon }): DemandResult {
  const maximum = productionCapacity(state, p, horizon).maximum;
  // Deviation-only sensitivity: the published zero-gap response is unchanged.
  // Never add a second Phillips-curve response to the policy's published CPI.
  const gap = initial.macro.realGdp / initial.macro.potentialGdp - 1;
  const slackFactor = Math.exp(Math.max(-1, Math.min(1, -p.gapDemandSensitivity * gap)));
  const priceFactor = Math.exp(Math.max(-1, Math.min(1, p.gapPriceSensitivity * gap)));
  const projects = projectResponses(initial, policies, horizon, p);
  const responses = policies.map((policy, i) => {
    const project = projects[i];
    const r = adjustedResponse(initial, policy, horizon, p, project);
    r.gdp *= slackFactor;
    r.prices *= priceFactor;
    r.deflator *= priceFactor;
    return { policy, project, net: projectNetOutput(project), r };
  });
  const positive = responses.reduce((sum, { r, net }) => sum + Math.max(0, r.gdp) + Math.max(0, net), 0);
  const negative = responses.reduce((sum, { r, net }) => sum + Math.min(0, r.gdp) + Math.min(0, net), 0);
  const scale = positive > 0 ? Math.min(1, Math.max(0, maximum - state.macro.realGdp - negative) / positive) : 1;
  const result: DemandResult = { additionalDemand: 0, realOutput: 0, exports: 0, imports: 0, prices: 0, capacityPriceAdjustment: 0,
    directTaxPriceEffect: 0, directTaxDeflatorEffect: 0, longRateEffect: 0,
    domesticSubstitution: 0, projectOperatingImports: 0, projectEnergyNetImports: 0,
    priceLevelEffect: 0, deflatorLevelEffect: 0, employmentEffect: 0, labourForceEffect: 0, hoursEffect: 0, details: [] };
  for (const { policy, r, project, net } of responses) {
    const real = r.gdp > 0 ? r.gdp * scale : r.gdp;
    const overflow = Math.max(0, r.gdp - real);
    const operationScale = net > 0 ? scale : 1;
    result.realOutput += real + net * operationScale;
    // The reference GDP response already includes net exports. Do not add it again.
    result.exports += r.exports + project.exports * operationScale;
    result.imports += r.imports + overflow * p.overflowImportShare + (project.operatingImports - project.substitution) * operationScale;
    result.domesticSubstitution += project.substitution * operationScale;
    result.projectOperatingImports += project.operatingImports * operationScale;
    if (project.power) result.projectEnergyNetImports += (project.operatingImports - project.substitution) * operationScale;
    result.prices += overflow * (1 - p.overflowImportShare);
    result.additionalDemand += r.gdp + r.imports - r.exports - project.domesticOperatingCost * operationScale;
    result.priceLevelEffect += r.prices;
    result.deflatorLevelEffect += r.deflator;
    result.directTaxPriceEffect += r.directTaxPrices;
    result.directTaxDeflatorEffect += r.directTaxDeflator;
    result.longRateEffect += r.longRate;
    result.employmentEffect += r.employment;
    result.labourForceEffect += r.labourForce;
    result.hoursEffect += r.hours;
    result.details.push({ policyId: policy.id, cost: policy.annualCost,
      baseMultiplier: policy.annualCost > 0 ? calibratedResponse(initial, policy, 1, p).gdp / (policy.annualCost / (initial.macro.nominalGdp / initial.macro.realGdp)) : 0,
      slackFactor, capacityFactor: r.gdp > 0 ? scale : 1, domesticRetentionFactor: project.retention,
      realOutput: real + net * operationScale, effectiveMultiplier: policy.annualCost > 0 ? (real + net * operationScale) / (policy.annualCost / (initial.macro.nominalGdp / initial.macro.realGdp)) : 0 });
  }
  // Replace only incremental congestion relative to reference headroom. This
  // is a price LEVEL, differenced into CPI; the full output gap is not added.
  const congestion = (u: number) => (Math.max(0, Math.min(1, u) - p.capacityPressureStart) / (1 - p.capacityPressureStart)) ** 2;
  const baseMaximum = productionCapacity({ ...initial, macro: { ...initial.macro, potentialGdp: baseline.potential } }, p, horizon).maximum;
  const referenceMaximum = baseline.potential * p.referenceCapacityRatio;
  const increment = positive + negative;
  result.capacityPriceAdjustment = p.capacityPriceSensitivity * (
    congestion((state.macro.realGdp + increment) / maximum) - congestion(baseline.real / baseMaximum)
    - congestion((baseline.real + increment) / referenceMaximum) + congestion(baseline.real / referenceMaximum));
  result.priceLevelEffect += result.capacityPriceAdjustment;
  result.deflatorLevelEffect += result.capacityPriceAdjustment;
  return result;
}
