export type HouseholdId = 'single' | 'single-children' | 'one-earner' | 'one-earner-children' | 'two-earners' | 'two-earners-children';
export type TaxView = 'curve' | 'revenue' | 'stats' | 'reform';
export type ConsumptionAssumption = 'net-fixed' | 'gross-fixed';

export interface HouseholdDefinition {
  id: HouseholdId;
  label: string;
  adults: 1 | 2;
  earners: 1 | 2;
  children: 0 | 2;
}

/** All monetary fields are annual yen unless their name explicitly says monthly. */
export interface Reform {
  basicAllowanceExtra: number;
  insuranceMultiplier: number;
  childMonthly: number;
  creditAnnual: number;
  creditPhaseoutStart: number;
  creditPhaseoutRate: number;
  standardVat: number;
  reducedVat: number;
}

export interface TaxState {
  view: TaxView;
  fy: number;
  household: HouseholdId;
  age: number;
  income: number;
  share: number;
  bonus: boolean;
  showAll: boolean;
  consumptionAssumption: ConsumptionAssumption;
  reform: Reform;
}

export interface TaxParameters {
  metadata: {
    fiscalYear: number;
    modelVersion: string;
    status: 'prototype';
    referenceDate: string;
    documentRevision: string;
    retrievedOn: string;
    originalPdfSha256: string | null;
    sourceUrl: string;
    notes: string[];
  };
  minimumAnnualWage: number;
  basicAllowances: [number, number][];
  incomeBrackets: [number, number, number][];
  salaryDeduction: [number, number, number][];
  spouseAllowances: [number, number, number][];
  monthlyRemuneration: number[];
  monthlyBoundaries: number[];
  pensionRate: number;
  healthRate: number;
  careRate: number;
  employmentRate: number;
  pensionMinimum: number;
  pensionCeiling: number;
  healthCeiling: number;
  pensionBonusCeiling: number;
  healthBonusCeiling: number;
  childMonthly: number;
  singleParentFullMonthly: number;
  singleParentExtraMonthly: number;
  singleParentThresholdBase: number;
  singleParentLimitBase: number;
  singleParentThresholdPerChild: number;
  localBasicAllowance: number;
  localRate: number;
  localPerCapita: number;
  reconstructionMultiplier: number;
}

export interface BurdenResult {
  income: number;
  salaries: number[];
  incomeTax: number;
  residentTax: number;
  pension: number;
  health: number;
  care: number;
  employment: number;
  childBenefit: number;
  singleParentBenefit: number;
  reformCredit: number;
  grossBurden: number;
  benefits: number;
  netBurden: number;
  netRate: number | null;
  outOfScope: boolean;
  scopeReasons: string[];
}

export interface ConsumptionBasket {
  /** Observed annual spending, including the baseline VAT. No imputed defaults. */
  standardGross: number;
  reducedGross: number;
  exemptGross: number;
}

export interface FiscalImpact {
  incomeTax: number;
  residentTax: number;
  insurance: number;
  benefitSpending: number;
  consumption: { status: 'uncomputed' } | { status: 'computed'; national: number; local: number };
  directBalance: number;
  totalBalance: number | null;
  outOfScope: boolean;
}

export interface TaxRevenue {
  metadata: { fiscalYear: number; budgetType: string; source: string; scope: string };
  taxes: { name: string; amount: number }[];
  stamp: number;
  total: number;
}
