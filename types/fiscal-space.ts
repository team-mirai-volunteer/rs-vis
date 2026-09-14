/** Money is yen; rates are fractions; real values use prototype year-0 prices. */
export interface SourceValue {
  key: string; value: number; unit: string; referenceYear: string;
  sourceName: string; sourceUrl: string | null; status: 'assumption' | 'verified';
  low?: number; high?: number; uncertaintyNote: string;
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
    interestPayments: number; grossDebt: number; financialAssets: number; netDebt: number;
    liquidFinancialAssets: number; liquidityAdjustedNetDebt: number };
  debtPortfolio: DebtBucket[];
  production: { inputs: Inputs; tfp: number; labourProductivity: number };
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
export interface Policy {
  id: string; name: string; kind: PolicyKind; channel: 'tax' | 'expenditure'; sector: Sector;
  annualCost: number; duration: number; baseMultiplier: number; importPropensity: number;
  inflationSensitivity: number; labourDemand: number; energyDemand: number;
  potentialGdpEffect: number; implementationLag: number;
  capitalEffect: number; tfpEffect: number; energyCapacityEffect: number; labourProductivityEffect: number;
}
export interface PolicyShare { policy: Policy; weight: number }
export interface Shock { marketRateDelta: number; energyPriceChange: number; realGrowthDelta: number }
export interface ModelParameters {
  baselineRealGrowth: number; baselineInflation: number; marketRate: number; newDebtMaturity: number;
  stockFlowAdjustmentRatio: number; gapMultiplierSensitivity: number; slackMultiplierSensitivity: number;
  supplySlackReference: number; sectorSlackReference: number; minimumCapacityFactor: number;
  overflowImportShare: number; inflationPassThrough: number; inflationPersistence: number;
  energyPricePassThrough: number; investmentDepreciation: number; goodsImportShare: number;
  essentialImportShare: number; wageInflationPassThrough: number; cesSigma: number;
  weights: Inputs; cobbWeights: Omit<Inputs, 'materials'>;
  searchCap: number; searchStep: number; searchTolerance: number; reserveShare: number;
}
export type ConstraintId = 'debt' | 'interestGdp' | 'interestTax' | 'gfn' | 'inflation' | 'capacity' | 'labour' | 'sector' | 'energy' | 'external';
export type Thresholds = Record<ConstraintId, number>;
export interface ConstraintResult {
  id: ConstraintId; label: string; year: number; currentValue: number; threshold: number;
  utilization: number; status: 'safe' | 'violated'; explanation: string;
}
export interface ConstraintDefinition {
  id: ConstraintId; label: string; measure: (step: ProjectionStep) => number;
  explain: (step: ProjectionStep) => string;
}
export interface ProductionResult {
  leontief: number; ces: number; cobbDouglas: number; maximum: number;
  binding: Input; second: Input; utilization: Inputs; remainingSlack: Inputs;
}
export interface DemandResult {
  additionalDemand: number; realOutput: number; imports: number; prices: number;
  details: { policyId: string; cost: number; baseMultiplier: number; slackFactor: number;
    capacityFactor: number; domesticRetentionFactor: number; effectiveMultiplier: number; realOutput: number }[];
}
export interface FiscalMetrics {
  grossDebtGdp: number; netDebtGdp: number; liquidityAdjustedNetDebtGdp: number; primaryBalanceGdp: number;
  interestGdp: number; interestTax: number; grossFinancingNeeds: number; gfnGdp: number;
  effectiveRate: number; stabilizingPrimaryBalance: number; stockFlowAdjustmentGdp: number;
}
export interface ProjectionStep {
  state: EconomyState; production: ProductionResult; demand: DemandResult; metrics: FiscalMetrics;
  outputGap: number; maximumGap: number; policyCost: number; maturingDebt: number;
  energyImportIncrease: number; inflationPressure: number; sectorDemand: Record<Sector, number>;
}
export interface Simulation { initial: ProjectionStep; steps: ProjectionStep[] }
export interface FiscalSpaceEstimate {
  theoreticalMaximum: number; emergencyReserve: number; recommendedEnvelope: number;
  status: 'boundary' | 'baseline-violated' | 'search-cap' | 'empty-mix';
  constraints: ConstraintResult[]; evaluations: number; tolerance: number;
  reserveRule: { method: 'fixed-share' | 'stress-scenarios'; share: number; scenarios?: string[] };
}
export interface PolicyComparison {
  policy: Policy; realGdpEffect: number; inflationPressure: number; imports: number; tradeBalanceEffect: number;
  debtGdp10y: number; debtGdpChange10y: number; potentialGdpEffect: number;
  mainCapacity: string; space: FiscalSpaceEstimate;
}
