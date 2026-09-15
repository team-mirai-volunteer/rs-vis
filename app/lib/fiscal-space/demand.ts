import type { DemandResult, EconomyState, ModelParameters, Policy } from '@/types/fiscal-space';
import { policyProfile } from './calibration';
import { productionCapacity } from './production';
import { adjustedResponse, projectResponses, projectNetOutput } from './project-response';

/** All decomposition amounts are year-0-price yen. Policy costs are nominal yen. */
export function allocateDemand(state: EconomyState, policies: Policy[], p: ModelParameters, horizon = 1, initial = state): DemandResult {
  const maximum = productionCapacity(state, p, horizon).maximum;
  const projects = projectResponses(initial, policies, horizon, p);
  const responses = policies.map((policy, i) => {
    const project = projects[i];
    return { policy, project, net: projectNetOutput(project),
      r: adjustedResponse(initial, policy, horizon, p, project) };
  });
  const positive = responses.reduce((sum, { r, net }) => sum + Math.max(0, r.gdp) + Math.max(0, net), 0);
  const negative = responses.reduce((sum, { r, net }) => sum + Math.min(0, r.gdp) + Math.min(0, net), 0);
  const scale = positive > 0 ? Math.min(1, Math.max(0, maximum - state.macro.realGdp - negative) / positive) : 1;
  const result: DemandResult = { additionalDemand: 0, realOutput: 0, exports: 0, imports: 0, prices: 0,
    domesticSubstitution: 0, projectEnergyNetImports: 0,
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
    if (project.power) result.projectEnergyNetImports += (project.operatingImports - project.substitution) * operationScale;
    result.prices += overflow * (1 - p.overflowImportShare);
    result.additionalDemand += r.gdp + r.imports - r.exports - project.domesticOperatingCost * operationScale;
    result.priceLevelEffect += r.prices;
    result.deflatorLevelEffect += r.deflator;
    result.employmentEffect += r.employment;
    result.labourForceEffect += r.labourForce;
    result.hoursEffect += r.hours;
    result.details.push({ policyId: policy.id, cost: policy.annualCost,
      baseMultiplier: policyProfile(policy, p).gdp[0] * p.multiplierScale,
      slackFactor: 1, capacityFactor: r.gdp > 0 ? scale : 1, domesticRetentionFactor: project.retention,
      realOutput: real + net * operationScale, effectiveMultiplier: policy.annualCost > 0 ? (real + net * operationScale) / (policy.annualCost / (initial.macro.nominalGdp / initial.macro.realGdp)) : 0 });
  }
  return result;
}
