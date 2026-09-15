import type { HouseholdDefinition, Reform, TaxItem, TaxState } from '@/types/tax-burden';

export const MODEL_VERSION = 'prototype-2025-4';
export const HOUSEHOLDS: HouseholdDefinition[] = [
  { id: 'single', label: '単身・子なし', adults: 1, earners: 1, children: 0 },
  { id: 'single-children', label: 'ひとり親・子2人', adults: 1, earners: 1, children: 2 },
  { id: 'one-earner', label: '片働き夫婦・子なし', adults: 2, earners: 1, children: 0 },
  { id: 'one-earner-children', label: '片働き夫婦・子2人', adults: 2, earners: 1, children: 2 },
  { id: 'two-earners', label: '共働き夫婦・子なし', adults: 2, earners: 2, children: 0 },
  { id: 'two-earners-children', label: '共働き夫婦・子2人', adults: 2, earners: 2, children: 2 },
];
export const TAX_ITEMS: { id: TaxItem; label: string }[] = [
  { id: 'net', label: '純負担（税＋保険料−給付−年金）' },
  { id: 'incomeTax', label: '所得税' },
  { id: 'residentTax', label: '住民税' },
  { id: 'pension', label: '年金保険料' },
  { id: 'health', label: '医療保険料（健保・国保・後期）' },
  { id: 'care', label: '介護保険料' },
  { id: 'employment', label: '雇用保険料' },
  { id: 'consumption', label: '消費税（推計）' },
  { id: 'benefits', label: '現金給付の合計（差し引き）' },
  { id: 'childBenefit', label: '児童手当（差し引き）' },
  { id: 'singleParentBenefit', label: '児童扶養手当（差し引き）' },
  { id: 'pensionSupport', label: '年金生活者支援給付金（差し引き）' },
  { id: 'reformCredit', label: '改革案の追加給付（差し引き）' },
  { id: 'corporateTax', label: '法人税の転嫁（仮定）' },
  { id: 'pensionReceipt', label: '公的年金の受給（差し引き）' },
];
/** Current law for the 2025 parameter file; validate-tax-burden-data checks that these still match it. */
export const BASE_REFORM: Reform = {
  basicAllowanceExtra: 0, localRate: 0.1, pensionRate: 0.0915, healthRate: 0.05, careRate: 0.008, employmentRate: 0.006,
  childMonthly: 10000, creditAnnual: 0, creditPhaseoutStart: 3000000, creditPhaseoutRate: 0.1,
  standardVat: 0.1, reducedVat: 0.08,
};

/** Ranges shared by the sliders, the URL reader and the runtime guard. */
export const REFORM_LIMITS: Record<keyof Reform, readonly [number, number]> = {
  basicAllowanceExtra: [-950000, 2000000], localRate: [0, 0.2], pensionRate: [0, 0.3], healthRate: [0, 0.2],
  careRate: [0, 0.05], employmentRate: [0, 0.05], childMonthly: [0, 50000],
  creditAnnual: [0, 1000000], creditPhaseoutStart: [0, 10000000], creditPhaseoutRate: [0, 1],
  standardVat: [0, 0.25], reducedVat: [0, 0.25],
};

/** Current law as the parameter file states it, which is what an untouched panel computes with. */
export const baseReform = (p: { childMonthly: number; localRate: number; pensionRate: number; healthRate: number; careRate: number; employmentRate: number }): Reform => ({
  ...BASE_REFORM, childMonthly: p.childMonthly, localRate: p.localRate, pensionRate: p.pensionRate,
  healthRate: p.healthRate, careRate: p.careRate, employmentRate: p.employmentRate,
});
/** True once any policy slider has been moved away from current law, which is what makes the reform curve appear. */
export const isReformed = (reform: Reform) => (Object.keys(BASE_REFORM) as (keyof Reform)[]).some(k => reform[k] !== BASE_REFORM[k]);

export function initialTaxState(): TaxState {
  return { view: 'curve', fy: 2025, household: 'one-earner-children', age: 40,
    income: 5000000, share: 67, bonus: false, showAll: true,
    consumptionAssumption: 'net-fixed', reform: { ...BASE_REFORM },
    // A quarter of the corporate income tax is assumed to reach wages: the one-year share in 土居 (2017) is about 27%
    // and the distributional conventions of public bodies are 18-25%. The long-run shares in the same Japanese
    // analyses are much higher (78-90%), so this is the conservative end and the user's to change.
    continuation: 0.7, workUntil: 65, includeConsumption: false, showOecd: false, corporateShare: 0.25,
    // Rates divide by the money actually received that year. Dividing by the working-age income class instead makes
    // retirement read as a large negative burden, which hides how much a pensioner still pays.
    firstBirthAge: 32, secondBirthAge: 34, denominator: 'income' };
}
