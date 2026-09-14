import type { ConsumptionDataset, LifecyclePhase, LifecycleYear, Reform, TaxParameters, TaxState } from '@/types/tax-burden';
import { BASE_REFORM, HOUSEHOLDS } from './households';
import { computeHousehold, employeeContributions, type AdultInput } from './household-tax';
import { childAgesAt, splitSalaries, validateState } from './simulate';
import { estimatedConsumptionTax } from './consumption-tax';

export const LIFECYCLE_START = 20;
export const LIFECYCLE_END = 85;

/** Annual old-age pension for one adult who earned `careerSalary` every year for the full contribution period. */
export function annualPension(careerSalary: number, bonus: boolean, p: TaxParameters): { basic: number; earningsRelated: number } {
  const lp = p.lifecycle;
  if (careerSalary <= 0) return { basic: lp.basicPensionFull, earningsRelated: 0 };
  const { averageStandard } = employeeContributions(careerSalary, 40, bonus, p, 1);
  return { basic: lp.basicPensionFull, earningsRelated: Math.round(averageStandard * lp.earningsRelatedRate * lp.contributionMonths) };
}

/** In-work old-age pension: half of the excess over the monthly threshold is suspended from the earnings-related part. */
export function inWorkPension(earningsRelated: number, salary: number, bonus: boolean, p: TaxParameters): number {
  const { averageStandard } = employeeContributions(salary, 65, bonus, p, 1);
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
export function lifecycleSeries(state: TaxState, p: TaxParameters, reform: Reform = { ...BASE_REFORM, childMonthly: p.childMonthly },
  consumption?: ConsumptionDataset | null): LifecycleYear[] {
  const household = validateState({ ...state, age: 40 }, reform);
  if (!Number.isFinite(state.continuation) || state.continuation < 0 || state.continuation > 1) throw new Error('継続雇用係数が有効な範囲にありません');
  if (!Number.isInteger(state.workUntil) || state.workUntil < p.lifecycle.pensionStartAge || state.workUntil > 75) throw new Error('就労終了年齢が有効な範囲にありません');
  const careerSalaries = splitSalaries(state.income, household.earners, state.share);
  const pensions = Array.from({ length: household.adults }, (_, i) => annualPension(careerSalaries[i] ?? 0, state.bonus, p));
  const scopeReasons = careerSalaries.flatMap((salary, i) => salary < p.minimumAnnualWage
    ? [`${i === 0 ? '第1就労者' : '第2就労者'}の給与がフルタイム下限未満`] : []);
  const years: LifecycleYear[] = [];
  for (let age = LIFECYCLE_START; age <= LIFECYCLE_END; age++) {
    const phase = phaseAt(age, state, p);
    const working = phase === 'work' || phase === 'reemployed' || phase === 'work-pension';
    const factor = phase === 'work' ? 1 : state.continuation;
    const adults: AdultInput[] = Array.from({ length: household.adults }, (_, i) => {
      const career = careerSalaries[i] ?? 0;
      const salary = working && career > 0 ? Math.round(career * factor) : 0;
      const receiving = age >= p.lifecycle.pensionStartAge;
      const earningsRelated = receiving ? (phase === 'work-pension' && salary > 0 ? inWorkPension(pensions[i].earningsRelated, salary, state.bonus, p) : pensions[i].earningsRelated) : 0;
      return { age, salary, pension: receiving ? pensions[i].basic + earningsRelated : 0, employeeInsured: salary > 0 };
    });
    const childAges = childAgesAt(age, household.children, p);
    const taxes = computeHousehold({ adults, childAges, loneParent: household.adults === 1 && household.children > 0, bonus: state.bonus }, p, reform);
    const gross = taxes.gross;
    const consumptionTax = state.includeConsumption && consumption
      ? estimatedConsumptionTax(consumption, gross, reform.standardVat, reform.reducedVat, state.consumptionAssumption) : 0;
    years.push({
      consumptionTax, netRateWithConsumption: gross > 0 ? (taxes.netBurden + consumptionTax) / gross : null,
      ageAt: age, phase, income: gross, salaries: adults.map(a => a.salary), salaryTotal: taxes.salaryTotal, pensionIncome: taxes.pensionTotal,
      incomeTax: taxes.incomeTax, residentTax: taxes.residentTax, pension: taxes.pension, health: taxes.health, care: taxes.care, employment: taxes.employment,
      childBenefit: taxes.childBenefit, singleParentBenefit: taxes.singleParentBenefit, pensionSupport: taxes.pensionSupport, reformCredit: taxes.reformCredit,
      grossBurden: taxes.grossBurden, benefits: taxes.benefits, netBurden: taxes.netBurden, netRate: gross > 0 ? taxes.netBurden / gross : null,
      disposable: gross - taxes.netBurden, childrenPresent: childAges.length,
      outOfScope: scopeReasons.length > 0, scopeReasons,
    });
  }
  return years;
}

export const HEATMAP_AGES = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80] as const;
export const HEATMAP_INCOMES = [2000000, 3000000, 4000000, 5000000, 6000000, 8000000, 10000000, 12000000, 15000000, 20000000] as const;

/** Model-based grid for view F: for each working-age income class, the burden of one tax item at each age. */
export function heatmapGrid(state: TaxState, p: TaxParameters, consumption?: ConsumptionDataset | null): { income: number; cells: LifecycleYear[] }[] {
  return HEATMAP_INCOMES.map(income => {
    const series = lifecycleSeries({ ...state, income, includeConsumption: true }, p, undefined, consumption);
    return { income, cells: HEATMAP_AGES.map(age => series.find(y => y.ageAt === age)!) };
  });
}

export const HOUSEHOLD_LABEL = (id: TaxState['household']) => HOUSEHOLDS.find(h => h.id === id)!.label;
