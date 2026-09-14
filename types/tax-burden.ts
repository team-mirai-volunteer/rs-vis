export type HouseholdId = 'single' | 'single-children' | 'one-earner' | 'one-earner-children' | 'two-earners' | 'two-earners-children';
export type TaxView = 'curve' | 'revenue' | 'stats' | 'reform' | 'age' | 'heatmap';
export type ConsumptionAssumption = 'net-fixed' | 'gross-fixed';
/** Tax items the heat-map can colour by. */
export type TaxItem = 'incomeTax' | 'residentTax' | 'pension' | 'health' | 'care' | 'employment' | 'consumption' | 'net';

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
  /** Life-cycle view: wage ratio kept while re-employed at 60–64 (0–1). */
  continuation: number;
  /** Life-cycle view: keep working at 65–69 with the in-work pension reduction applied. */
  workTo69: boolean;
  /** Heat-map view: tax item to colour by. */
  taxItem: TaxItem;
  /** Add the estimated consumption tax (家計調査の十分位別支出構成から推計) to the burden. */
  includeConsumption: boolean;
  /** Overlay OECD average / min / max at the stylised earnings points. */
  showOecd: boolean;
}

/** Rules for pension income, retiree insurance and lifecycle assumptions (annual yen unless stated). */
export interface LifecycleParameters {
  /** Adult age at each child's birth; child i is born when the adult turns childBirthAges[i]. */
  childBirthAges: number[];
  /** Children leave the household (no longer dependants) at this age. */
  childLeavesAt: number;
  pensionStartAge: number;
  retirementAge: number;
  contributionMonths: number;
  basicPensionFull: number;
  /** Earnings-related multiplier per month of contribution (e.g. 5.481/1000). */
  earningsRelatedRate: number;
  /** In-work old-age pension: monthly threshold above which half of the excess is suspended. */
  inWorkPensionThreshold: number;
  /** Public pension deduction brackets [upper, rate, fixed] for under 65 / 65 and over. */
  pensionDeductionUnder65: [number, number, number][];
  pensionDeduction65: [number, number, number][];
  pensionDeductionMinimumUnder65: number;
  pensionDeductionMinimum65: number;
  elderlySpouseAllowance: [number, number];
  dependantAllowanceGeneral: [number, number];
  dependantAllowanceSpecific: [number, number];
  nationalHealth: {
    basicRate: number; basicPerCapita: number; basicCap: number;
    supportRate: number; supportPerCapita: number; supportCap: number;
    careRate: number; carePerCapita: number; careCap: number;
    /** Per-capita reduction thresholds: [reduction ratio, base, per member, per extra earner]. */
    reductions: [number, number, number, number][];
  };
  latterStageHealth: { rate: number; perCapita: number; cap: number; reductions: [number, number, number, number][] };
  careFirstCategory: { baseAnnual: number; stages: { stage: number; multiplier: number }[] };
  pensionSupport: { monthly: number; incomeThreshold: number };
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
  childMonthlyUnder3: number;
  singleParentFullMonthly: number;
  singleParentExtraMonthly: number;
  singleParentThresholdBase: number;
  singleParentLimitBase: number;
  singleParentThresholdPerChild: number;
  singleParentFirstCoefficient: number;
  singleParentExtraCoefficient: number;
  localBasicAllowance: number;
  localRate: number;
  localPerCapita: number;
  localForestTax: number;
  /** Statutory personal-deduction differences used by the local adjustment credit. */
  adjustmentBasicDifference: number;
  reconstructionMultiplier: number;
  lifecycle: LifecycleParameters;
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
  /** Estimated consumption tax when the add-on is enabled (0 otherwise). */
  consumptionTax: number;
  /** Rate including the consumption-tax estimate; null when income is 0. */
  netRateWithConsumption: number | null;
}

export type LifecyclePhase = 'work' | 'reemployed' | 'work-pension' | 'pension';

export interface LifecycleYear extends BurdenResult {
  ageAt: number;
  phase: LifecyclePhase;
  salaryTotal: number;
  pensionIncome: number;
  pensionSupport: number;
  disposable: number;
  childrenPresent: number;
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

/** 家計調査 年収十分位別の税込消費支出（課税区分別）と直接税・社会保険料（年額）。 */
export interface ConsumptionDecile {
  decile: number;
  lowerBound: number | null;
  upperBound: number | null;
  annualIncome: number;
  householdSize: number;
  earners: number;
  headAge: number;
  realIncomeAnnual: number;
  disposableAnnual: number;
  consumptionAnnual: number;
  standardGross: number;
  reducedGross: number;
  exemptGross: number;
  directTaxes: { incomeTax: number; residentTax: number; other: number };
  socialInsurance: { pension: number; health: number; care: number; other: number };
  propensity: number;
}

export interface ConsumptionDataset {
  metadata: { survey: string; statInfId: string; sourceUrl: string; population: string; unit: string; retrievedOn: string; mapVersion: string; notes: string[] };
  deciles: ConsumptionDecile[];
}

/** 家計調査 世帯主年齢階級別（勤労者世帯・無職世帯）。年間収入は非公表のため realIncomeAnnual を分母に使う。 */
export interface AgeClass {
  label: string;
  headAge: number;
  householdSize: number;
  earners: number;
  realIncomeAnnual: number;
  salaryAnnual: number;
  pensionBenefitAnnual: number;
  disposableAnnual: number;
  consumptionAnnual: number;
  standardGross: number;
  reducedGross: number;
  exemptGross: number;
  directTaxes: { incomeTax: number; residentTax: number; other: number };
  socialInsurance: { pension: number; health: number; care: number; other: number };
}

export interface AgeDataset {
  metadata: { survey: string; statInfId: string; sourceUrl: string; unit: string; retrievedOn: string; mapVersion: string; notes: string[] };
  groups: { population: string; classes: AgeClass[] }[];
}

export interface OecdPoint {
  household: HouseholdId;
  oecdHouseholdType: string;
  principal: string;
  spouse: string;
  awRatioTotal: number;
  suggestedShare: number | null;
  japan: number | null;
  oecdAverage: number;
  min: number;
  minCountry: string;
  max: number;
  maxCountry: string;
  countries: number;
  /** R8 reference values for Japan (yen; NPATR in %). */
  japanDetail: Partial<Record<'GEBT' | 'CGITFP' | 'SLT' | 'EECSSC' | 'CTGG' | 'NPATR' | 'THP', number>>;
}

/** Continuous 50-250% of average wage curve for one stylised household (OECD Taxing Wages decompositions). */
export interface OecdCurve {
  oecdHouseholdType: string;
  year: string;
  averageWageJpy: number;
  averageSource: string;
  awRatio: number[];
  japan: (number | null)[];
  oecdAverage: number[];
  min: number[];
  minCountry: string[];
  max: number[];
  maxCountry: string[];
  countries: number[];
  /** Japan reference amounts (yen, absolute values) per awRatio: gross wage, central/local income tax, employee SSC, cash benefits. */
  japanDetail: Record<'GWE' | 'IT_CG' | 'IT_LG' | 'EESSC' | 'CB', (number | null)[]>;
}

export interface OecdDataset {
  metadata: { source: string; sourceUrl: string; retrievedOn: string; notes: string[] };
  years: Record<string, { averageWageJpy: number | null; points: OecdPoint[] }>;
  /** Keyed by our household id; two-earner households have no continuous series. */
  curves: Partial<Record<HouseholdId, OecdCurve>>;
}
