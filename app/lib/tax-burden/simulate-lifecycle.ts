import type { ConsumptionDataset, IncidenceDataset, LifecyclePhase, LifecycleYear, Reform, TaxParameters, TaxState } from '@/types/tax-burden';
import { baseReform, HOUSEHOLDS } from './households';
import { computeHousehold, employeeContributions, type AdultInput } from './household-tax';
import { childAgesAt, splitSalaries, validateState } from './simulate';
import { estimatedConsumptionTax } from './consumption-tax';
import { corporateTaxOnWages } from './incidence';

export const LIFECYCLE_START = 20;
export const LIFECYCLE_END = 85;

/** Annual old-age pension for one adult who earned `careerSalary` every year for the full contribution period. */
export function annualPension(careerSalary: number, bonus: boolean, p: TaxParameters): { basic: number; earningsRelated: number } {
  const lp = p.lifecycle;
  if (careerSalary <= 0) return { basic: lp.basicPensionFull, earningsRelated: 0 };
  const { averageStandard } = employeeContributions(careerSalary, 40, bonus, p, p);
  return { basic: lp.basicPensionFull, earningsRelated: Math.round(averageStandard * lp.earningsRelatedRate * lp.contributionMonths) };
}

/** In-work old-age pension: half of the excess over the monthly threshold is suspended from the earnings-related part. */
export function inWorkPension(earningsRelated: number, salary: number, bonus: boolean, p: TaxParameters): number {
  const { averageStandard } = employeeContributions(salary, 65, bonus, p, p);
  const monthlyExcess = averageStandard + earningsRelated / 12 - p.lifecycle.inWorkPensionThreshold;
  const suspended = Math.max(0, monthlyExcess / 2) * 12;
  return Math.max(0, Math.round(earningsRelated - suspended));
}

export function phaseAt(age: number, state: Pick<TaxState, 'workUntil'>, p: TaxParameters): LifecyclePhase {
  const lp = p.lifecycle;
  if (age < lp.retirementAge) return 'work';
  if (age < lp.pensionStartAge) return 'reemployed';
  if (age < state.workUntil) return 'work-pension';
  return 'pension';
}

/** Burden by age for a household whose working-age income class is fixed (view E). */
export function lifecycleSeries(state: TaxState, p: TaxParameters, reform: Reform = baseReform(p),
  consumption?: ConsumptionDataset | null, incidence?: IncidenceDataset | null): LifecycleYear[] {
  const household = validateState({ ...state, age: 40 }, reform);
  if (!Number.isFinite(state.continuation) || state.continuation < 0 || state.continuation > 1) throw new Error('継続雇用係数が有効な範囲にありません');
  if (!Number.isInteger(state.workUntil) || state.workUntil < p.lifecycle.pensionStartAge || state.workUntil > 75) throw new Error('就労終了年齢が有効な範囲にありません');
  const careerSalaries = splitSalaries(state.income, household.earners, state.share);
  const pensions = Array.from({ length: household.adults }, (_, i) => annualPension(careerSalaries[i] ?? 0, state.bonus, p));
  const scopeReasons = careerSalaries.flatMap((salary, i) => salary < p.employeeInsuranceThreshold
    ? [`${i === 0 ? '第1就労者' : '第2就労者'}の給与が被用者保険の賃金要件未満`] : []);
  const years: LifecycleYear[] = [];
  // Resident tax is assessed on the previous year (前年所得課税): what a household pays at age N was computed from the
  // income and premiums of age N-1. That is why it stays at the working level the year after retiring, and why the first
  // working year pays none. National health, latter-stage medical and first-category care premiums are assessed the same
  // way in reality, but this model still bases them on the current year (noted in the parameter file).
  let payableResidentTax = 0;
  for (let age = LIFECYCLE_START; age <= LIFECYCLE_END; age++) {
    const phase = phaseAt(age, state, p);
    const working = phase === 'work' || phase === 'reemployed' || phase === 'work-pension';
    const factor = phase === 'work' ? 1 : state.continuation;
    const adults: AdultInput[] = Array.from({ length: household.adults }, (_, i) => {
      const career = careerSalaries[i] ?? 0;
      const salary = working && career > 0 ? Math.round(career * factor) : 0;
      const receiving = age >= p.lifecycle.pensionStartAge;
      const earningsRelated = receiving ? (phase === 'work-pension' && salary > 0 ? inWorkPension(pensions[i].earningsRelated, salary, state.bonus, p) : pensions[i].earningsRelated) : 0;
      return { age, salary, pension: receiving ? pensions[i].basic + earningsRelated : 0, employeeInsured: salary >= p.employeeInsuranceThreshold };
    });
    const childAges = childAgesAt(age, household.children, p, state);
    const taxes = computeHousehold({ adults, childAges, loneParent: household.adults === 1 && household.children > 0, bonus: state.bonus }, p, reform);
    const gross = taxes.gross;
    const consumptionTax = state.includeConsumption && consumption
      ? estimatedConsumptionTax(consumption, gross, reform.standardVat, reform.reducedVat, state.consumptionAssumption) : 0;
    const careerIncome = Math.round(state.income);
    const residentTax = payableResidentTax;
    payableResidentTax = taxes.residentTax;
    const corporateTax = corporateTaxOnWages(incidence, taxes.salaryTotal, state.corporateShare);
    const grossBurden = taxes.grossBurden - taxes.residentTax + residentTax + corporateTax;
    const netBurden = grossBurden - taxes.benefits;
    const pensionAdjustedBurden = netBurden + consumptionTax - taxes.pensionTotal;
    years.push({
      careerIncome, pensionAdjustedBurden, careerRate: careerIncome > 0 ? pensionAdjustedBurden / careerIncome : null,
      corporateTax, consumptionTax, netRateWithConsumption: gross > 0 ? (netBurden + consumptionTax) / gross : null,
      ageAt: age, phase, income: gross, salaries: adults.map(a => a.salary), salaryTotal: taxes.salaryTotal, pensionIncome: taxes.pensionTotal,
      incomeTax: taxes.incomeTax, residentTax, pension: taxes.pension, health: taxes.health, care: taxes.care, employment: taxes.employment,
      childBenefit: taxes.childBenefit, singleParentBenefit: taxes.singleParentBenefit, pensionSupport: taxes.pensionSupport, reformCredit: taxes.reformCredit,
      grossBurden, benefits: taxes.benefits, netBurden, netRate: gross > 0 ? netBurden / gross : null,
      disposable: gross - netBurden, childrenPresent: childAges.length,
      outOfScope: scopeReasons.length > 0, scopeReasons,
    });
  }
  return years;
}

export const HEATMAP_AGES = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80] as const;
export const HEATMAP_INCOMES = [2000000, 3000000, 4000000, 5000000, 6000000, 8000000, 10000000, 12000000, 15000000, 20000000] as const;

/** Model-based grid for view F: for each working-age income class, the burden of one tax item at each age. */
export function heatmapGrid(state: TaxState, p: TaxParameters, consumption?: ConsumptionDataset | null,
  incidence?: IncidenceDataset | null, reform?: Reform): { income: number; cells: LifecycleYear[] }[] {
  return HEATMAP_INCOMES.map(income => {
    const series = lifecycleSeries({ ...state, income, includeConsumption: true }, p, reform, consumption, incidence);
    return { income, cells: HEATMAP_AGES.map(age => series.find(y => y.ageAt === age)!) };
  });
}

export const HOUSEHOLD_LABEL = (id: TaxState['household']) => HOUSEHOLDS.find(h => h.id === id)!.label;
