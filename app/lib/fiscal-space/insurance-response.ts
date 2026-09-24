import type { EconomyState, ModelParameters, Policy } from '@/types/fiscal-space';

export interface InsuranceAssumptions {
  enabled: boolean;
  wagePassThrough: number;
  netWageRetention: number;
  adjustmentYears: number;
  hoursElasticity: number;
  participationElasticity: number;
  demandElasticity: number;
}

/** Sensitivity centre, not a Japanese causal estimate. See fiscal-space-insurance.md. */
export const INSURANCE_DEFAULTS: InsuranceAssumptions = {
  enabled: true, wagePassThrough: .5, netWageRetention: .7, adjustmentYears: 5,
  hoursElasticity: .1, participationElasticity: .05, demandElasticity: .2,
};
export const INSURANCE_LEGACY: InsuranceAssumptions = { ...INSURANCE_DEFAULTS, enabled: false };

export function validateInsurance(c: InsuranceAssumptions | undefined, tail: number | undefined) {
  if (tail !== undefined && (!Number.isInteger(tail) || tail < 0 || tail > 30)) throw new RangeError('Invalid macro tail');
  if (!c) return;
  if (typeof c.enabled !== 'boolean' || !Number.isInteger(c.adjustmentYears) || c.adjustmentYears < 1 || c.adjustmentYears > 20
    || [c.wagePassThrough, c.netWageRetention, c.hoursElasticity, c.participationElasticity, c.demandElasticity]
      .some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new RangeError('Invalid insurance response');
}

/** Current-year flows only. Wage incidence and remaining cost relief exhaust the employer cut. */
export function insuranceIncidence(policies: Policy[], year: number, employeeShare: number, c?: InsuranceAssumptions) {
  const budget = policies.filter(x => x.id === 'social-insurance' && (x.kind === 'permanent' || year <= x.duration))
    .reduce((sum, x) => sum + x.annualCost, 0);
  const employee = budget * employeeShare, employer = budget - employee;
  const wage = employer * (c?.enabled ? c.wagePassThrough * Math.min(1, year / c.adjustmentYears) : 0);
  return { employee, employer, wage, netWage: wage * (c?.netWageRetention ?? 0), remainingCostRelief: employer - wage };
}

/** After the published horizon, phase in explicit structural responses. Employment
 * is bounded by both new participants and employer demand; it is not their sum.
 * Nonzero legacy elasticities override the corresponding new insurance response. */
export function insuranceLabour(initial: EconomyState, policies: Policy[], year: number, p: ModelParameters, referenceYears: number) {
  const c = p.insurance, incidence = insuranceIncidence(policies, year, p.employeeReliefShare, c);
  const ramp = c?.enabled ? Math.min(1, Math.max(0, year - referenceYears) / c.adjustmentYears) : 0;
  const nominal = initial.macro.nominalGdp * ((1 + p.baselineRealGrowth) * (1 + p.baselineInflation)) ** year;
  const netRatio = 1 + (incidence.employee + incidence.netWage) / (nominal * p.netLabourIncomeShare);
  const costRatio = 1 - incidence.remainingCostRelief / (nominal * p.employerLabourCostShare);
  if (costRatio <= 0) throw new RangeError('Insurance relief exceeds payroll');
  const hours = netRatio ** ((p.hoursElasticity > 0 ? 0 : c?.hoursElasticity ?? 0) * ramp);
  const participation = Math.min(1 / initial.labour.participation,
    netRatio ** ((p.participationElasticity > 0 ? 0 : c?.participationElasticity ?? 0) * ramp));
  const demand = costRatio ** -((p.employerDemandElasticity > 0 ? 0 : c?.demandElasticity ?? 0) * ramp);
  const employment = Math.min(participation, demand);
  return { ...incidence, hours, participation, employment, productiveLabour: hours * employment };
}

/** Common closure for all published macro responses. Zero retains the legacy plateau. */
export function macroTailFactor(year: number, referenceYears: number, tailYears = 0) {
  return tailYears === 0 ? 1 : Math.max(0, 1 - Math.max(0, year - referenceYears) / tailYears);
}
