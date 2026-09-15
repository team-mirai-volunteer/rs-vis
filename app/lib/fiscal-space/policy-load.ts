import type { EconomyState, ModelParameters, Policy, PolicyLoad, ProjectLoadBasis, Sector } from '@/types/fiscal-space';
import { SECTORS, TRILLION } from './assumptions';

export const EMPTY_PROJECT_BASIS: ProjectLoadBasis = {
  budgetTrillion: 1, workerYears: null, sectorWorkerCapacity: null,
  constructionPeakMw: null, operatingPeakMw: null, annualOperatingGwh: null,
  annualLoadFactor: null, peakCoincidence: null,
};

/** Convert an explicit project scale, never public expenditure alone, into
 * load coefficients. Annual GWh do not by themselves identify peak demand. */
export function loadFromProject(basis: ProjectLoadBasis): Pick<PolicyLoad,
  'sectorUtilizationPerTrillion' | 'peakGwPerTrillion' | 'operatingPeakGwPerTrillion'> {
  if (Object.values(basis).some(v => v !== null && (!Number.isFinite(v) || v < 0)) ||
    basis.budgetTrillion <= 0 || basis.sectorWorkerCapacity === 0 ||
    (basis.annualLoadFactor !== null && (basis.annualLoadFactor <= 0 || basis.annualLoadFactor > 1)) ||
    (basis.peakCoincidence !== null && basis.peakCoincidence > 1)) throw new RangeError('Invalid project load basis');
  const operatingGw = basis.operatingPeakMw !== null ? basis.operatingPeakMw / 1000
    : basis.annualOperatingGwh !== null && basis.annualLoadFactor !== null && basis.peakCoincidence !== null
      ? basis.annualOperatingGwh / 8760 / basis.annualLoadFactor * basis.peakCoincidence : null;
  return {
    sectorUtilizationPerTrillion: basis.workerYears !== null && basis.sectorWorkerCapacity !== null
      ? basis.workerYears / basis.sectorWorkerCapacity / basis.budgetTrillion : null,
    peakGwPerTrillion: basis.constructionPeakMw === null ? null : basis.constructionPeakMw / 1000 / basis.budgetTrillion,
    operatingPeakGwPerTrillion: operatingGw === null ? null : operatingGw / basis.budgetTrillion,
  };
}

export function effectiveLoad(load: PolicyLoad): PolicyLoad {
  return load.basis ? { ...load, ...loadFromProject(load.basis) } : load;
}

export function loadCoverage(load: PolicyLoad | undefined) {
  const c = load && effectiveLoad(load);
  return {
    sector: !!c && c.sectorUtilizationPerTrillion !== null,
    energy: !!c && c.peakGwPerTrillion !== null && c.operatingPeakGwPerTrillion !== null,
  };
}

/** Coefficients are explicit scenarios until matched to an IO table / project.
 * Spending-year loads and operating vintages have different lifetimes. */
export function policyLoads(initial: EconomyState, policies: Policy[], year: number, p: ModelParameters) {
  const sectorDemand = Object.fromEntries(SECTORS.map(s => [s, 0])) as Record<Sector, number>;
  let peakGw = 0;
  const coverage = { sector: true, energy: true };
  for (const policy of policies.filter(x => x.annualCost > 0)) {
    const c = policy.load && effectiveLoad(policy.load);
    const known = loadCoverage(policy.load);
    coverage.sector &&= known.sector;
    coverage.energy &&= known.energy;
    if (!c) continue;
    if ([c.sectorUtilizationPerTrillion, c.peakGwPerTrillion, c.operatingPeakGwPerTrillion,
      c.lag, c.lifetime, c.depreciation].some(v => v !== null && (!Number.isFinite(v) || v < 0)) || c.depreciation > 1 ||
      !Number.isInteger(c.lag) || !Number.isInteger(c.lifetime) || c.lifetime < 1) throw new RangeError('Invalid policy load assumptions');
    if (c.estimated && (!Number.isFinite(c.priceIndex) || c.priceIndex! <= 0 ||
      !c.sectorLoads || SECTORS.some(s => !Number.isFinite(c.sectorLoads![s]) || c.sectorLoads![s] < 0))) {
      throw new RangeError('Invalid estimated policy load');
    }
    let price = c.estimated ? c.priceIndex! : initial.macro.nominalGdp / initial.macro.realGdp;
    for (let paid = 1; paid <= year; paid++) {
      if (policy.kind === 'permanent' || paid <= policy.duration) {
        const cost = policy.annualCost / price / TRILLION;
        if (paid === year) {
          if (c.estimated && c.sectorLoads) {
            for (const sector of SECTORS) sectorDemand[sector] += cost * c.sectorLoads[sector];
          } else sectorDemand[policy.sector] += cost * (c.sectorUtilizationPerTrillion ?? 0);
          peakGw += cost * (c.peakGwPerTrillion ?? 0);
        }
        const age = year - paid - c.lag;
        if (age >= 0 && age < c.lifetime) peakGw += cost * (c.operatingPeakGwPerTrillion ?? 0) * (1 - c.depreciation) ** age;
      }
      price *= 1 + p.baselineInflation + p.inflationPersistence ** paid * (initial.macro.inflation - p.baselineInflation);
    }
  }
  return { sectorDemand, peakGw, coverage };
}
