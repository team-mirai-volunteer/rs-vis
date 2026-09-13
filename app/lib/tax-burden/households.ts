import type { HouseholdDefinition, Reform, TaxState } from '@/types/tax-burden';

export const MODEL_VERSION = 'prototype-2025-1';
export const HOUSEHOLDS: HouseholdDefinition[] = [
  { id: 'single', label: '単身・子なし', adults: 1, earners: 1, children: 0 },
  { id: 'single-children', label: 'ひとり親・子2人', adults: 1, earners: 1, children: 2 },
  { id: 'one-earner', label: '片働き夫婦・子なし', adults: 2, earners: 1, children: 0 },
  { id: 'one-earner-children', label: '片働き夫婦・子2人', adults: 2, earners: 1, children: 2 },
  { id: 'two-earners', label: '共働き夫婦・子なし', adults: 2, earners: 2, children: 0 },
  { id: 'two-earners-children', label: '共働き夫婦・子2人', adults: 2, earners: 2, children: 2 },
];
export const BASE_REFORM: Reform = {
  basicAllowanceExtra: 0, insuranceMultiplier: 1, childMonthly: 10000,
  creditAnnual: 0, creditPhaseoutStart: 3000000, creditPhaseoutRate: 0.1,
  standardVat: 0.1, reducedVat: 0.08,
};
export function initialTaxState(): TaxState {
  return { view: 'curve', fy: 2025, household: 'one-earner-children', age: 40,
    income: 5000000, share: 67, bonus: false, showAll: true,
    consumptionAssumption: 'net-fixed', reform: { ...BASE_REFORM } };
}
