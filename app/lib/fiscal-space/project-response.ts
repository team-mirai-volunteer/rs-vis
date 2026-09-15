import type { EconomyState, ModelParameters, Policy } from '@/types/fiscal-space';
import { calibratedResponse, policyProfile } from './calibration';
import { industryTrade, powerTrade, powerComponents } from './policy-trade';
import { effectiveSupplyStock } from './supply';
import { electricityBaseline } from './electricity-baseline';

// Factory/power project inputs. Grid has its own fuel-saving pathway below;
// roads and transmission assets are not treated as export factories.
export const PROJECT_POLICY_IDS = ['rd', 'semiconductors', 'generation'];

/** Use the same no-policy deflator for every investment vintage as calibration.ts.
 * Construction is replaced, not counted a second time. Operating flows are
 * incremental to the reference experiment, conditional on additional sales.
 * Missing operating costs never license counting only the benefit. */
export interface ProjectFlow {
  exports: number; substitution: number; operatingImports: number; firmGw: number;
  power: boolean; grid: boolean; renewableSubstitution: number; gridOverlapShare: number;
  domesticOperatingCost: number; operatingConfigured: boolean; retention: number; capexImportCorrection: number;
}
export const projectNetOutput = (flow: ProjectFlow) => flow.exports + flow.substitution - flow.operatingImports - flow.domesticOperatingCost;

export function projectResponse(initial: EconomyState, policy: Policy, year: number, p: ModelParameters): ProjectFlow {
  const result = { exports: 0, substitution: 0, operatingImports: 0, firmGw: 0,
    grid: false, renewableSubstitution: 0, gridOverlapShare: 0, domesticOperatingCost: 0,
    power: policy.trade?.kind === 'power', operatingConfigured: false, retention: 1,
    capexImportCorrection: 0 };
  const config = policy.trade;
  if (policy.supply?.kind === 'grid') {
    if (policy.id !== 'grid' || config || policy.energyCapacityEffect !== 0) throw new RangeError('Grid supply must use the grid energy pathway only');
    const c = policy.supply;
    const maintenance = c.maintenanceRate ?? .01, imported = c.maintenanceImportShare ?? .2, overlap = c.generationOverlapShare ?? 1;
    if ([maintenance, imported, overlap].some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new RangeError('Invalid grid operating assumptions');
    const stock = effectiveSupplyStock(initial, policy, year, p);
    result.grid = true; result.power = true; result.operatingConfigured = true; result.gridOverlapShare = overlap;
    // The existing yield is net of maintenance. Recover fuel savings, exclude
    // domestic fuel expenditure, then charge imported and domestic upkeep once.
    result.substitution = stock * (c.yield + maintenance) * initial.energy.fossilFuelImportDependency;
    result.operatingImports = stock * maintenance * imported;
    result.domesticOperatingCost = stock * maintenance * (1 - imported);
    return result;
  }
  if (!config) return result;
  if (!PROJECT_POLICY_IDS.includes(policy.id) || policy.channel !== 'expenditure') throw new RangeError('Project investment must be mapped to an investment policy');
  if (config.kind === 'power' && policy.id !== 'generation') throw new RangeError('Power configuration requires generation investment');
  if (config.kind === 'power' && config.assumptions.mix) {
    const components = powerComponents(config.assumptions);
    const flows = components.map(x => projectResponse(initial, { ...policy, annualCost: policy.annualCost * x.share, trade: { kind: 'power', assumptions: x.assumptions } }, year, p));
    for (const key of ['exports', 'substitution', 'operatingImports', 'firmGw', 'renewableSubstitution', 'domesticOperatingCost', 'capexImportCorrection'] as const) result[key] = flows.reduce((sum, f) => sum + f[key], 0);
    result.retention = flows.reduce((sum, f, i) => sum + f.retention * components[i].share, 0);
    result.operatingConfigured = flows.every(f => f.operatingConfigured);
    return result;
  }
  result.operatingConfigured = config.kind === 'industry'
    ? config.assumptions.annualSalesPerInvestment !== null : config.assumptions.operatingImportYenPerKwh !== null;
  if (result.operatingConfigured && [policy.potentialGdpEffect, policy.tfpEffect, policy.labourProductivityEffect, policy.energyCapacityEffect].some(v => v > 0)) {
    throw new RangeError('Use project capacity or generic supply coefficients, not both for the same investment');
  }
  let price = initial.macro.nominalGdp / initial.macro.realGdp;
  for (let paid = 1; paid <= year; paid++) {
    if (policy.kind === 'permanent' || paid <= policy.duration) {
      const vintage = { ...policy, annualCost: policy.annualCost / price, kind: 'temporary' as const, duration: 1 };
      const flow = config.kind === 'industry'
        ? industryTrade(vintage, year - paid + 1, config.assumptions)
        : powerTrade(vintage, year - paid + 1, config.assumptions);
      if (result.operatingConfigured) {
        result.exports += flow.exports ?? 0;
        result.substitution += flow.substitution ?? 0;
        result.operatingImports += flow.operatingImports ?? 0;
      }
      if ('firmGw' in flow) result.firmGw += flow.firmGw ?? 0;
    }
    // Baseline price before payment in paid+1.
    if (paid < year) price *= 1 + p.baselineInflation + p.inflationPersistence ** paid * (initial.macro.inflation - p.baselineInflation);
  }
  const share = config.assumptions.capexImportShare;
  if (config.kind === 'power' && config.assumptions.technology !== 'nuclear') result.renewableSubstitution = result.substitution;
  if (share !== null) {
    // Published year-1 imports include induced demand: this anchor is a proxy,
    // not an identified direct-import coefficient from an input-output table.
    const anchor = policyProfile(policy, p).imports[0] * initial.external.imports / initial.macro.nominalGdp;
    if (anchor < 0 || anchor >= 1) throw new RangeError('Reference import anchor outside the adjustment domain');
    result.retention = (1 - share) / (1 - anchor);
    const cost = policy.kind === 'permanent' || year <= policy.duration ? policy.annualCost / price : 0;
    result.capexImportCorrection = cost * (share - anchor * result.retention);
  }
  return result;
}

/** Cap overlapping import replacement jointly across policies and vintages.
 * These national ceilings prevent negative imports, not sector market forecasts. */
export function projectResponses(initial: EconomyState, policies: Policy[], year: number, p: ModelParameters) {
  const flows = policies.map(policy => projectResponse(initial, policy, year, p));
  const price = initial.macro.nominalGdp / initial.macro.realGdp;
  // A master-plan grid benefit can overlap the extra renewable generation.
  // Remove the shared portion once across all grid investments, independent
  // of row order. 100% is the conservative default; users can change it.
  const renewable = flows.reduce((sum, f) => sum + f.renewableSubstitution, 0);
  const overlapping = flows.reduce((sum, f) => sum + (f.grid ? f.substitution * f.gridOverlapShare : 0), 0);
  const removed = Math.min(renewable, overlapping);
  if (overlapping > 0) for (const flow of flows) if (flow.grid) flow.substitution -= removed * flow.substitution * flow.gridOverlapShare / overlapping;
  for (const power of [true, false]) {
    const total = flows.filter(f => f.power === power).reduce((sum, f) => sum + f.substitution, 0);
    const available = (power ? Math.max(0, Math.min(initial.energy.importBill + electricityBaseline(p.electricity, year).additionalFuelBill, electricityBaseline(p.electricity, year).fuelBill))
      : Math.max(0, initial.external.imports - initial.energy.importBill)) / price;
    const scale = total > 0 ? Math.min(1, available / total) : 1;
    for (const flow of flows) if (flow.power === power) flow.substitution *= scale;
  }
  return flows;
}

export function adjustedResponse(initial: EconomyState, policy: Policy, year: number, p: ModelParameters, project: ReturnType<typeof projectResponse>) {
  const r = calibratedResponse(initial, policy, year, p);
  // Apply the same retained domestic stimulus to output, prices and labour.
  // The reference GDP already contains its own net exports.
  for (const key of Object.keys(r) as (keyof typeof r)[]) r[key] *= project.retention;
  r.imports += project.capexImportCorrection;
  return r;
}
