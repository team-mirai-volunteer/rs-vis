import type { EconomyState, Inputs, ModelParameters, Policy } from '@/types/fiscal-space';
import { investmentPricePath } from './investment-price';
import { supplyInputs } from './supply';
import { REFERENCES, taxLabourSupply } from './calibration';
import { positive, productionCapacity, productionIndex } from './production';
import { projectNetOutput, projectResponses } from './project-response';
import { powerComponents } from './policy-trade';

/** One input-to-production path for short-run potential, maximum capacity,
 * commissioning comparisons and long-run supply. Normal utilization is calibrated
 * to the initial potential GDP; maximum utilization retains the input headroom. */
export function policyProduction(initial: EconomyState, policies: Policy[], year: number, p: ModelParameters,
  baselinePotential = initial.macro.potentialGdp * (1 + p.baselineRealGrowth) ** year,
  prices = investmentPricePath(initial, p), realized = false, includeTax = true) {
  const factors = supplyInputs(initial, policies, year, p, realized, prices);
  let manualEnergy = 0;
  const referenceYears = REFERENCES[p.referenceModel].years;
  for (let paid = 1; paid <= year; paid++) {
    const realization = realized ? Math.min(1, Math.max(0, (year - paid + 1 - referenceYears) / (10 - referenceYears))) : 1;
    for (const policy of policies) {
      const age = year - paid - policy.implementationLag;
      if ((policy.kind !== 'permanent' && paid > policy.duration) || age < 0) continue;
      const stock = policy.annualCost / prices(paid) * (1 - p.investmentDepreciation) ** age * realization;
      factors.capital += stock / initial.macro.realGdp * policy.capitalEffect;
      factors.energy += stock / initial.macro.realGdp * policy.energyCapacityEffect;
      manualEnergy += stock / initial.macro.realGdp * policy.energyCapacityEffect;
      factors.labour += stock / initial.macro.realGdp * policy.labourProductivityEffect;
      factors.tfp += stock / initial.macro.realGdp * policy.tfpEffect + stock / initial.macro.potentialGdp * policy.potentialGdpEffect;
    }
  }
  // Operating projects are represented by equivalent productive inputs. Their
  // imports/exports are still realized through demand, never added here as GDP.
  // Fixed conversion elasticities must not change when selecting another model.
  if (!realized) {
    const projects = projectResponses(initial, policies, year, p, prices);
    const industry = projects.filter(x => !x.power).reduce((s, x) => s + Math.max(0, projectNetOutput(x)), 0);
    let energy = 0, firmNet = 0, firmGw = 0;
    projects.forEach((flow, i) => {
      if (!flow.power) return;
      const trade = policies[i].trade;
      const knownFirm = trade?.kind === 'power' && powerComponents(trade.assumptions).every(x => x.assumptions.firmShare !== null);
      if (knownFirm) { firmNet += Math.max(0, projectNetOutput(flow)); firmGw += flow.firmGw; }
      else energy += Math.max(0, projectNetOutput(flow));
    });
    // Where firm GW is supplied, it caps the equivalent productive energy gain.
    // This is one gain subject to two limits, not two benefits from the same plant.
    energy += Math.min(firmNet, initial.macro.potentialGdp * Math.expm1(.15 * Math.log1p(firmGw / initial.energy.firmCapacity)));
    factors.capital += Math.expm1(Math.log1p(industry / initial.macro.potentialGdp) / .35);
    factors.energy += Math.expm1(Math.log1p(energy / initial.macro.potentialGdp) / .15);
  }
  if (includeTax) {
    const labour = taxLabourSupply(initial, policies, year, p);
    factors.labour *= labour.hours * labour.participation;
  }
  const initialEffective = { ...initial.production.inputs, labour: initial.production.inputs.labour * initial.production.labourProductivity };
  const degree = p.productionModel === 'cobbDouglas' ? Object.values(p.cobbWeights).reduce((sum, x) => sum + x, 0) : 1;
  positive(degree, 'production homogeneity degree');
  const normalizer = (initial.production.tfp * productionIndex(initialEffective, p)) ** (1 / degree);
  const inputs = { ...initial.production.inputs }, normalInputs = {} as Inputs;
  for (const key of Object.keys(inputs) as (keyof Inputs)[]) {
    inputs[key] *= factors[key];
    normalInputs[key] = inputs[key] / normalizer;
  }
  const production = { inputs, normalInputs, basePotentialGdp: baselinePotential,
    tfp: initial.production.tfp * factors.tfp, labourProductivity: initial.production.labourProductivity };
  const capacity = productionCapacity({ ...initial, production }, p, year);
  return { production, manualEnergy, ...capacity };
}
