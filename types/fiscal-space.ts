import type { IndustryTradeCase, PowerCase } from '@/app/lib/fiscal-space/policy-trade';

/** Money is yen; rates are fractions; real values use the selected year-0 prices. */
export interface SourceValue {
  key: string; value: number; unit: string; referenceYear: string;
  sourceName: string; sourceUrl: string | null; status: 'assumption' | 'verified' | 'derived' | 'estimated';
  low?: number; high?: number; uncertaintyNote: string;
  publishedAt?: string;
  retainedReason?: string;
}
export type Input = 'capital' | 'labour' | 'energy' | 'materials';
export type Inputs = Record<Input, number>;
export type Sector = 'general' | 'construction' | 'healthcare' | 'research' | 'electronics' | 'electricity';
export interface DebtBucket { principal: number; coupon: number; maturityYear: number }
export interface EconomyState {
  year: number;
  macro: { nominalGdp: number; realGdp: number; potentialGdp: number; inflation: number;
    coreInflation: number; expectedInflation: number; nominalWageGrowth: number; realGrowth: number; nominalGrowth: number };
  fiscal: { primaryBalance: number; structuralPrimaryBalance: number; taxRevenue: number; primaryExpenditure: number;
    interestPayments: number; interestRevenue: number; otherPrimaryRevenue: number;
    grossDebt: number; financialAssets: number; netDebt: number;
    liquidFinancialAssets: number; liquidityAdjustedNetDebt: number };
  debtPortfolio: DebtBucket[];
  production: { inputs: Inputs; tfp: number; labourProductivity: number; normalInputs?: Inputs; basePotentialGdp?: number };
  labour: { labourForce: number; employment: number; unemployment: number; hoursWorked: number;
    participation: number; wageGrowth: number; sectorUtilization: Record<Sector, number> };
  energy: { primaryDemand: number; domesticSupply: number; importedEnergy: number; fossilFuelImportDependency: number;
    firmCapacity: number; peakDemand: number; reserveMargin: number; importBill: number;
    renewableInstalledCapacity: number; renewableFirmContribution: number };
  external: { exports: number; imports: number; tradeBalance: number; goodsBalance: number; servicesBalance: number;
    primaryIncomeBalance: number; secondaryIncomeBalance: number; currentAccount: number; niip: number;
    termsOfTrade: number; essentialImports: number };
  resilience: Partial<Record<'energyImportConcentration' | 'calorieSelfSufficiency' | 'proteinSelfSufficiency' |
    'feedDependency' | 'fertilizerDependency' | 'agriculturalEnergyDependency' | 'stockpileDays' |
    'criticalMinerals' | 'geopoliticalConcentration', SourceValue>>;
}
export type PolicyKind = 'temporary' | 'permanent' | 'growth';
export interface ProjectLoadBasis {
  budgetTrillion: number;
  workerYears: number | null;
  sectorWorkerCapacity: number | null;
  constructionPeakMw: number | null;
  operatingPeakMw: number | null;
  annualOperatingGwh: number | null;
  annualLoadFactor: number | null;
  peakCoincidence: number | null;
}
export interface PolicyLoad {
  sectorUtilizationPerTrillion: number | null;
  peakGwPerTrillion: number | null;
  operatingPeakGwPerTrillion: number | null;
  lag: number; lifetime: number; depreciation: number;
  basis?: ProjectLoadBasis;
  /** Generated from the versioned IO reference, never accepted from shared URLs. */
  estimated?: boolean;
  sectorLoads?: Record<Sector, number>;
  workerYears?: Record<Sector, number>;
  priceIndex?: number;
}
export interface ResourceAssumptions {
  mode: 'estimated' | 'manual'; loadScale: number; spendingShare: number;
  priceIndex: number; electricityPrice: number; loadFactor: number; coincidence: number;
  operatingOutputRatio: number;
  region: 'demand-share' | '北海道' | '東北' | '東京' | '中部' | '北陸' | '関西' | '中国' | '四国' | '九州' | '沖縄';
}
export interface Policy {
  id: string; name: string; kind: PolicyKind; channel: 'tax' | 'expenditure'; sector: Sector;
  annualCost: number; duration: number; energyDemand: number;
  potentialGdpEffect: number; implementationLag: number;
  capitalEffect: number; tfpEffect: number; energyCapacityEffect: number; labourProductivityEffect: number;
  trade?: { kind: 'industry'; assumptions: IndustryTradeCase } | { kind: 'power'; assumptions: PowerCase };
  supply?: import('@/app/lib/fiscal-space/supply').SupplyCase;
  /** Explicit project / input-output coefficients; absence means unevaluated. */
  load?: PolicyLoad;
}
export interface PolicyShare { policy: Policy; weight: number }
export interface Shock { marketRateDelta: number; energyPriceChange: number; realGrowthDelta: number }
export interface ModelParameters {
  resourceModel?: ResourceAssumptions;
  taxRevenueElasticity: number; taxCollectionLag: number;
  productionModel: 'leontief' | 'ces' | 'cobbDouglas';
  gapDemandSensitivity: number; gapPriceSensitivity: number; gapInflationSlope: number;
  consumptionTax: { revenuePerPoint: number; cpiShare: number; baseRate: number; passThrough: number; referenceDirectCpi: number; referenceDirectDeflator: number };
  electricity: import('@/app/lib/fiscal-space/electricity-baseline').ElectricityBaselineCase;
  referenceModel: 'ef2026' | 'esri2022'; multiplierScale: number;
  hoursElasticity: number; participationElasticity: number; netLabourIncomeShare: number;
  employeeReliefShare: number; employerDemandElasticity: number; employerLabourCostShare: number;
  baselineRealGrowth: number; baselineInflation: number; marketRate: number; newDebtMaturity: number;
  stockFlowAdjustmentRatio: number;
  overflowImportShare: number; inflationPassThrough: number; inflationPersistence: number;
  energyPricePassThrough: number; investmentDepreciation: number; goodsImportShare: number;
  energyDomesticPricePassThrough: number; expenditurePriceIndexation: number;
  capacityPriceSensitivity: number; capacityPressureStart: number; referenceCapacityRatio: number;
  essentialImportShare: number; wageInflationPassThrough: number; cesSigma: number;
  weights: Inputs; cobbWeights: Omit<Inputs, 'materials'>;
  searchCap: number; searchStep: number; searchTolerance: number; reserveShare: number;
}
export type ConstraintId = 'debt' | 'interestGdp' | 'interestTax' | 'gfn' | 'inflation' | 'capacity' | 'labour' | 'sector' | 'energy' | 'external';
export type Thresholds = Record<ConstraintId, number>;
export interface ConstraintResult {
  /** Independent of violation status: all evaluated years have known policy loads. */
  coverageComplete?: boolean;
  id: ConstraintId; label: string; year: number; currentValue: number; threshold: number;
  utilization: number; status: 'safe' | 'violated' | 'unevaluated'; explanation: string;
}
export interface ConstraintDefinition {
  id: ConstraintId; label: string; measure: (step: ProjectionStep) => number;
  explain: (step: ProjectionStep) => string;
}
export interface ProductionResult {
  potential: number;
  leontief: number; ces: number; cobbDouglas: number; maximum: number;
  binding: Input; second: Input; utilization: Inputs; remainingSlack: Inputs;
}
export interface DemandResult {
  capacityPriceAdjustment: number;
  directTaxPriceEffect: number; directTaxDeflatorEffect: number; longRateEffect: number;
  additionalDemand: number; realOutput: number; exports: number; imports: number; prices: number;
  domesticSubstitution: number; projectEnergyNetImports: number;
  priceLevelEffect: number; deflatorLevelEffect: number; employmentEffect: number; labourForceEffect: number; hoursEffect: number;
  details: { policyId: string; cost: number; baseMultiplier: number; slackFactor: number;
    capacityFactor: number; domesticRetentionFactor: number; effectiveMultiplier: number; realOutput: number }[];
}
export interface FiscalMetrics {
  grossDebtGdp: number; netDebtGdp: number; liquidityAdjustedNetDebtGdp: number; primaryBalanceGdp: number;
  interestGdp: number; interestTax: number; grossFinancingNeeds: number; gfnGdp: number;
  effectiveRate: number; stabilizingPrimaryBalance: number; stockFlowAdjustmentGdp: number;
}
export interface ProjectionStep {
  resourcePower?: ReturnType<typeof import('@/app/lib/fiscal-space/resource-estimate').resourcePowerBalance>;
  estimatedLoads?: boolean;
  importPriceEffects?: { domesticPriceRecovery: number; gdpDeflatorLevelEffect: number; tradingIncomeChange: number; realDomesticIncome: number; expenditureIndex: number };
  taxAdjustedInflation?: number; refinancingRate?: number; referenceRateEffect?: number;
  coverage?: { sector: boolean; energy: boolean };
  electricity?: { demandTwh: number; thermalTwh: number; thermalIncreaseTwh: number; commonFuelIncrease: number; operatingImportReduction: number };
  state: EconomyState; production: ProductionResult; demand: DemandResult; metrics: FiscalMetrics;
  outputGap: number; maximumGap: number; policyCost: number; maturingDebt: number;
  energyImportIncrease: number; inflationPressure: number; sectorDemand: Record<Sector, number>;
}
export interface Simulation { initial: ProjectionStep; steps: ProjectionStep[] }
export interface FiscalSpaceEstimate {
  theoreticalMaximum: number; emergencyReserve: number; recommendedEnvelope: number;
  status: 'boundary' | 'baseline-violated' | 'search-cap' | 'revenue-cap' | 'empty-mix';
  limitingPolicy?: string;
  constraints: ConstraintResult[]; evaluations: number; tolerance: number;
  reserveRule: { method: 'fixed-share' | 'stress-scenarios'; share: number; scenarios?: string[] };
}
export interface PolicyComparisonPeriod {
  year: 1 | 3 | 5;
  realGdpEffect: number; inflationPressure: number;
  exports: number; imports: number; tradeBalanceEffect: number; domesticSubstitution: number;
  energyOperatingTradeEffect: number;
  debtGdp: number; debtGdpChange: number; potentialGdpEffect: number;
}
export interface PolicyComparison {
  publishedYears: number;
  supplyNote: string;
  investment?: {
    startYear: number; lifetime: number;
    timings?: { name: string; startYear: number; lifetime: number }[];
    supply?: number;
    trade?: { exports: number; imports: number; substitution: number; operatingImports: number; tradeBalance: number };
  };
  periods: PolicyComparisonPeriod[];
  supplyEffectConfigured: boolean;
  policy: Policy; realGdpEffect: number; inflationPressure: number; exports: number; imports: number; tradeBalanceEffect: number;
  debtGdpAtHorizon: number; debtGdpChangeAtHorizon: number; potentialGdpEffect: number;
  mainCapacity: string; space: FiscalSpaceEstimate;
}
