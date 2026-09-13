import type { BurdenResult, HouseholdId, Reform, TaxParameters, TaxState } from '@/types/tax-burden';
import { BASE_REFORM, HOUSEHOLDS } from './households';

const floorTo = (value: number, unit: number) => Math.floor(Math.max(0, value) / unit) * unit;

export function salaryIncome(gross: number, hasChildren: boolean, p: TaxParameters): number {
  const row = p.salaryDeduction.find(([upper]) => gross <= upper)!;
  const adjustment = hasChildren ? Math.max(0, Math.min(gross, 10000000) - 8500000) * 0.1 : 0;
  return Math.max(0, gross - (gross * row[1] + row[2]) - adjustment);
}

export function incomeTaxFromBase(base: number, p: TaxParameters): number {
  const taxable = floorTo(base, 1000);
  const [, rate, deduction] = p.incomeBrackets.find(([upper]) => taxable < upper)!;
  return floorTo((taxable * rate - deduction) * p.reconstructionMultiplier, 100);
}

export function standardMonthlyRemuneration(monthly: number, p: TaxParameters): number {
  const index = p.monthlyBoundaries.findIndex(upper => monthly < upper);
  return p.monthlyRemuneration[index < 0 ? p.monthlyRemuneration.length - 1 : index];
}

export function simulate(state: Pick<TaxState, 'income' | 'household' | 'share' | 'age' | 'bonus'>,
  p: TaxParameters, reform: Reform = { ...BASE_REFORM, childMonthly: p.childMonthly }): BurdenResult {
  const household = HOUSEHOLDS.find(h => h.id === state.household);
  if (!household || !Number.isFinite(state.income) || state.income < 0 || state.income > 20000000 ||
      !Number.isFinite(state.share) || state.share < 1 || state.share > 99 ||
      !Number.isInteger(state.age) || state.age < 20 || state.age > 64 ||
      Object.values(reform).some(v => !Number.isFinite(v) || v < 0)) throw new Error('計算条件が有効な範囲にありません');
  const income = Math.round(state.income);
  const first = household.earners === 2 ? Math.round(income * state.share / 100) : income;
  const salaries = household.earners === 2 ? [first, income - first] : [income];
  const scopeReasons = salaries.flatMap((salary, i) => salary < p.minimumAnnualWage
    ? [`${i === 0 ? '第1就労者' : '第2就労者'}の給与がフルタイム下限未満`] : []);
  const taxableIncomes = salaries.map(s => salaryIncome(s, household.children > 0, p));
  const principal = salaries.length === 2 && salaries[1] > salaries[0] ? 1 : 0;
  const loneParent = household.adults === 1 && household.children > 0;
  let incomeTax = 0, residentTax = 0, pension = 0, health = 0, care = 0, employment = 0;
  let singleParentBenefit = 0;
  salaries.forEach((salary, i) => {
    // Non-working partner is not in salaries. An earners=2 household with a zero income earner is out of scope.
    const monthly = salary / (state.bonus ? 14 : 12);
    const standard = standardMonthlyRemuneration(monthly, p);
    const bonus = state.bonus ? floorTo(monthly, 1000) : 0;
    const pensionBase = Math.min(p.pensionCeiling, Math.max(p.pensionMinimum, standard)) * 12 + Math.min(p.pensionBonusCeiling, bonus) * 2;
    const healthBase = Math.min(p.healthCeiling, standard) * 12 + Math.min(p.healthBonusCeiling, bonus * 2);
    const pensionPart = Math.round(pensionBase * p.pensionRate * reform.insuranceMultiplier);
    const healthPart = Math.round(healthBase * p.healthRate * reform.insuranceMultiplier);
    const carePart = state.age >= 40 ? Math.round(healthBase * p.careRate * reform.insuranceMultiplier) : 0;
    const employmentPart = Math.round(salary * p.employmentRate * reform.insuranceMultiplier);
    const social = pensionPart + healthPart + carePart + employmentPart;
    pension += pensionPart; health += healthPart; care += carePart; employment += employmentPart;
    const reference = taxableIncomes[i];
    const partnerReference = household.earners === 2 ? taxableIncomes[1 - i] : 0;
    const hasSpouse = household.adults === 2;
    const spouseMultiplier = reference <= 9000000 ? 1 : reference <= 9500000 ? 2 / 3 : reference <= 10000000 ? 1 / 3 : 0;
    const spouseRow = p.spouseAllowances.find(([upper]) => partnerReference <= upper)!;
    const spouse = hasSpouse && i === principal ? Math.ceil(spouseRow[1] * spouseMultiplier / 10000) * 10000 : 0;
    const localSpouse = hasSpouse && i === principal ? Math.ceil(spouseRow[2] * spouseMultiplier / 10000) * 10000 : 0;
    const basic = p.basicAllowances.find(([upper]) => reference <= upper)![1] + reform.basicAllowanceExtra;
    const parent = loneParent && reference <= 5000000 ? 350000 : 0;
    const localParent = loneParent && reference <= 5000000 ? 300000 : 0;
    incomeTax += incomeTaxFromBase(reference - social - basic - spouse - parent, p);
    const localBase = floorTo(reference - social - p.localBasicAllowance - localSpouse - localParent, 1000);
    const dependants = i === principal ? household.children + (hasSpouse && partnerReference <= 580000 ? 1 : 0) : 0;
    const fixedExemption = 350000 * (1 + dependants) + 100000 + (dependants ? 210000 : 0);
    const proportionalExemption = 350000 * (1 + dependants) + 100000 + (dependants ? 320000 : 0);
    const exemption = loneParent && reference <= 1350000;
    // OECD description §8.2.4. Reform extra is excluded from the baseline personal-deduction difference.
    const deductionDifference = Math.max(0, basic - reform.basicAllowanceExtra + spouse + parent - p.localBasicAllowance - localSpouse - localParent);
    const adjustment = localBase <= 2000000 ? 0.05 * Math.min(deductionDifference, localBase)
      : Math.max(2500, 0.05 * (deductionDifference - (localBase - 2000000)));
    residentTax += exemption ? 0 : (reference <= fixedExemption ? 0 : p.localPerCapita) +
      (reference <= proportionalExemption ? 0 : floorTo(localBase * p.localRate - adjustment, 100));
    if (loneParent) {
      const assessed = Math.max(0, reference - 80000 - social);
      const full = p.singleParentThresholdBase + household.children * p.singleParentThresholdPerChild;
      const limit = p.singleParentLimitBase + household.children * p.singleParentThresholdPerChild;
      if (assessed < limit) {
        const excess = Math.max(0, assessed - full);
        const firstBenefit = p.singleParentFullMonthly - (excess > 0 ? excess * 0.025 + 10 : 0);
        const extra = p.singleParentExtraMonthly - (excess > 0 ? excess * 0.0038561 + 10 : 0);
        singleParentBenefit = Math.max(0, Math.round((firstBenefit + (household.children - 1) * extra) / 10) * 10 * 12);
      }
    }
  });
  const childBenefit = household.children * reform.childMonthly * 12;
  // Prototype reform: one refundable credit per household, phased out against gross household salary.
  const reformCredit = Math.round(Math.max(0, reform.creditAnnual - Math.max(0, income - reform.creditPhaseoutStart) * reform.creditPhaseoutRate));
  const grossBurden = incomeTax + residentTax + pension + health + care + employment;
  const benefits = childBenefit + singleParentBenefit + reformCredit;
  const netBurden = grossBurden - benefits;
  return { income, salaries, incomeTax, residentTax, pension, health, care, employment,
    childBenefit, singleParentBenefit, reformCredit, grossBurden, benefits, netBurden,
    netRate: income > 0 ? netBurden / income : null, outOfScope: scopeReasons.length > 0, scopeReasons };
}

export function curveSeries(state: TaxState, p: TaxParameters, id: HouseholdId, reform?: Reform): BurdenResult[] {
  return Array.from({ length: 401 }, (_, i) => simulate({ ...state, household: id, income: i === 0 ? 10000 : i * 50000 }, p, reform));
}
