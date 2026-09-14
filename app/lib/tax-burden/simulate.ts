import type { BurdenResult, ConsumptionDataset, HouseholdId, IncidenceDataset, Reform, TaxParameters, TaxState } from '@/types/tax-burden';
import { BASE_REFORM, HOUSEHOLDS } from './households';
import { computeHousehold, type AdultInput } from './household-tax';
import { estimatedConsumptionTax } from './consumption-tax';
import { corporateTaxOnWages } from './incidence';

export type SimulateState = Pick<TaxState, 'income' | 'household' | 'share' | 'age' | 'bonus'> &
  Partial<Pick<TaxState, 'includeConsumption' | 'consumptionAssumption' | 'corporateShare'>>;

export { salaryIncome, incomeTaxFromBase, standardMonthlyRemuneration, pensionIncome } from './household-tax';

/** Children's ages at the adult's age: born when the adult turned childBirthAges[i], leave at childLeavesAt. */
export function childAgesAt(adultAge: number, count: number, p: TaxParameters): number[] {
  return p.lifecycle.childBirthAges.slice(0, count).map(birth => adultAge - birth).filter(a => a >= 0 && a < p.lifecycle.childLeavesAt);
}

export function validateState(state: Pick<TaxState, 'income' | 'household' | 'share' | 'age'>, reform: Reform) {
  const household = HOUSEHOLDS.find(h => h.id === state.household);
  if (!household || !Number.isFinite(state.income) || state.income < 0 || state.income > 20000000 ||
      !Number.isFinite(state.share) || state.share < 1 || state.share > 99 ||
      !Number.isInteger(state.age) || state.age < 20 || state.age > 64 ||
      Object.values(reform).some(v => !Number.isFinite(v) || v < 0)) throw new Error('計算条件が有効な範囲にありません');
  return household;
}

export function splitSalaries(income: number, earners: number, share: number): number[] {
  const rounded = Math.round(income);
  if (earners !== 2) return [rounded];
  const first = Math.round(rounded * share / 100);
  return [first, rounded - first];
}

/** Working-age household (view C): salaried adults of the same age, children at their age for that adult age. */
export function simulate(state: SimulateState, p: TaxParameters,
  reform: Reform = { ...BASE_REFORM, childMonthly: p.childMonthly }, consumption?: ConsumptionDataset | null,
  incidence?: IncidenceDataset | null): BurdenResult {
  const household = validateState(state, reform);
  const salaries = splitSalaries(state.income, household.earners, state.share);
  const scopeReasons = salaries.flatMap((salary, i) => salary < p.minimumAnnualWage
    ? [`${i === 0 ? '第1就労者' : '第2就労者'}の給与がフルタイム下限未満`] : []);
  const adults: AdultInput[] = Array.from({ length: household.adults }, (_, i) => ({
    age: state.age, salary: salaries[i] ?? 0, pension: 0, employeeInsured: (salaries[i] ?? 0) > 0,
  }));
  const taxes = computeHousehold({ adults, childAges: childAgesAt(state.age, household.children, p),
    loneParent: household.adults === 1 && household.children > 0, bonus: state.bonus }, p, reform);
  const income = Math.round(state.income);
  const consumptionTax = state.includeConsumption && consumption
    ? estimatedConsumptionTax(consumption, income, reform.standardVat, reform.reducedVat, state.consumptionAssumption ?? 'net-fixed') : 0;
  // Corporate tax passed on to wages is an assumption, so it only enters when the caller sets a share above zero.
  const corporateTax = corporateTaxOnWages(incidence, salaries.reduce((total, s) => total + s, 0), state.corporateShare ?? 0);
  const grossBurden = taxes.grossBurden + corporateTax;
  const netBurden = grossBurden - taxes.benefits;
  return { income, salaries, consumptionTax, corporateTax, netRateWithConsumption: income > 0 ? (netBurden + consumptionTax) / income : null,
    incomeTax: taxes.incomeTax, residentTax: taxes.residentTax, pension: taxes.pension, health: taxes.health,
    care: taxes.care, employment: taxes.employment, childBenefit: taxes.childBenefit, singleParentBenefit: taxes.singleParentBenefit,
    reformCredit: taxes.reformCredit, grossBurden, benefits: taxes.benefits, netBurden,
    netRate: income > 0 ? netBurden / income : null, outOfScope: scopeReasons.length > 0, scopeReasons };
}

export function curveSeries(state: TaxState, p: TaxParameters, id: HouseholdId, reform?: Reform,
  consumption?: ConsumptionDataset | null, incidence?: IncidenceDataset | null): BurdenResult[] {
  return Array.from({ length: 401 }, (_, i) => simulate({ ...state, household: id, income: i === 0 ? 10000 : i * 50000 }, p, reform, consumption, incidence));
}
