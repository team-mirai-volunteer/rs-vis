import type { EconomyState, ModelParameters, Policy, Sector, Shock, SourceValue, Thresholds } from '@/types/fiscal-space';

export const TRILLION = 1e12;
export const SECTORS: Sector[] = ['general', 'construction', 'healthcare', 'research', 'electronics', 'electricity'];
export const SECTOR_LABELS: Record<Sector, string> = { general: '全産業', construction: '建設', healthcare: '医療', research: '研究', electronics: '電子・半導体', electricity: '電力' };
export const INPUT_LABELS = { capital: '設備', labour: '労働', energy: 'エネルギー', materials: '中間財' };
/** ASSUMPTION: synthetic economy, not a calibrated estimate of Japan. */
export const PARAMETERS: ModelParameters = {
  baselineRealGrowth: .01, baselineInflation: .02, marketRate: .02, newDebtMaturity: 10,
  stockFlowAdjustmentRatio: 0, gapMultiplierSensitivity: 2, slackMultiplierSensitivity: 1,
  supplySlackReference: .12, sectorSlackReference: .15, minimumCapacityFactor: .05,
  overflowImportShare: .4, inflationPassThrough: 1.4, inflationPersistence: .25,
  energyPricePassThrough: .25, investmentDepreciation: .03, goodsImportShare: .75,
  essentialImportShare: .25, wageInflationPassThrough: .8, cesSigma: .8,
  weights: { capital: .3, labour: .4, energy: .15, materials: .15 },
  cobbWeights: { capital: .35, labour: .5, energy: .15 },
  searchCap: 100 * TRILLION, searchStep: TRILLION, searchTolerance: .01 * TRILLION, reserveShare: .2,
};
export const THRESHOLDS: Thresholds = { debt: 2.8, interestGdp: .065, interestTax: .3, gfn: .45,
  inflation: .05, capacity: .995, labour: .995, sector: 1, energy: .95, external: .3 };
export const NO_SHOCK: Shock = { marketRateDelta: 0, energyPriceChange: 0, realGrowthDelta: 0 };
export function initialEconomy(): EconomyState {
  const gdp = 600 * TRILLION, debt = 1320 * TRILLION;
  return {
    year: 0,
    macro: { nominalGdp: gdp, realGdp: gdp, potentialGdp: 612 * TRILLION, inflation: .02,
      coreInflation: .02, expectedInflation: .02, nominalWageGrowth: .03, realGrowth: .01, nominalGrowth: .0302 },
    fiscal: { primaryBalance: -6 * TRILLION, structuralPrimaryBalance: -3 * TRILLION,
      taxRevenue: 150 * TRILLION, primaryExpenditure: 156 * TRILLION, interestPayments: debt * .01,
      grossDebt: debt, financialAssets: 420 * TRILLION, netDebt: 900 * TRILLION,
      liquidFinancialAssets: 120 * TRILLION, liquidityAdjustedNetDebt: 1200 * TRILLION },
    debtPortfolio: Array.from({ length: 10 }, (_, i) => ({ principal: debt / 10, coupon: .01, maturityYear: i + 1 })),
    production: { inputs: { capital: 1.18, labour: 1.08, energy: 1.12, materials: 1.2 }, tfp: 1, labourProductivity: 1 },
    labour: { labourForce: 70e6, employment: 67e6, unemployment: 3e6, hoursWorked: 1700,
      participation: .65, wageGrowth: .03,
      sectorUtilization: { general: .87, construction: .94, healthcare: .92, research: .8, electronics: .88, electricity: .89 } },
    energy: { primaryDemand: 100, domesticSupply: 20, importedEnergy: 80, fossilFuelImportDependency: .95,
      firmCapacity: 200, peakDemand: 170, reserveMargin: 30 / 170, importBill: 24 * TRILLION,
      renewableInstalledCapacity: 100, renewableFirmContribution: 20 },
    external: { exports: 110 * TRILLION, imports: 120 * TRILLION, tradeBalance: -10 * TRILLION,
      goodsBalance: -7 * TRILLION, servicesBalance: -3 * TRILLION, primaryIncomeBalance: 30 * TRILLION,
      secondaryIncomeBalance: -2 * TRILLION, currentAccount: 18 * TRILLION, niip: 450 * TRILLION,
      termsOfTrade: 1, essentialImports: 40 * TRILLION }, resilience: {},
  };
}

const policy = (id: string, name: string, overrides: Partial<Policy>): Policy => ({
  id, name, kind: 'temporary', channel: 'expenditure', sector: 'general', annualCost: TRILLION,
  duration: 3, baseMultiplier: 1, importPropensity: .2, inflationSensitivity: 1,
  labourDemand: .15, energyDemand: .1, potentialGdpEffect: 0, implementationLag: 0,
  capitalEffect: 0, tfpEffect: 0, energyCapacityEffect: 0, labourProductivityEffect: 0, ...overrides,
});
/** Every coefficient below is a named prototype assumption, not empirical evidence. */
export const POLICIES: Policy[] = [
  policy('income-tax', '所得税減税', { channel: 'tax', kind: 'permanent', baseMultiplier: .8, importPropensity: .25 }),
  policy('consumption-tax', '消費税減税', { channel: 'tax', kind: 'permanent', baseMultiplier: 1, importPropensity: .3 }),
  policy('social-insurance', '社会保険料減税', { channel: 'tax', kind: 'permanent', baseMultiplier: .9, importPropensity: .2 }),
  policy('cash', '現金給付', { baseMultiplier: .9, importPropensity: .25 }),
  policy('public-investment', '公共投資', { kind: 'growth', sector: 'construction', baseMultiplier: 1.4,
    labourDemand: 2, energyDemand: .5, potentialGdpEffect: .3, capitalEffect: .8, implementationLag: 2 }),
  policy('defence', '防衛', { baseMultiplier: .9, importPropensity: .5, labourDemand: .5, energyDemand: .6 }),
  policy('healthcare', '医療', { sector: 'healthcare', baseMultiplier: 1.2, labourDemand: 1.8, energyDemand: .2 }),
  policy('childcare', '子育て', { baseMultiplier: 1.1, labourDemand: .7, potentialGdpEffect: .2, implementationLag: 4 }),
  policy('education', '教育', { kind: 'growth', baseMultiplier: 1.1, labourDemand: .8,
    potentialGdpEffect: .5, labourProductivityEffect: .5, implementationLag: 4 }),
  policy('rd', 'R&D', { kind: 'growth', sector: 'research', baseMultiplier: 1.1, importPropensity: .15,
    labourDemand: .8, potentialGdpEffect: 1.5, tfpEffect: .5, implementationLag: 3 }),
  policy('semiconductors', '半導体・産業投資', { kind: 'growth', sector: 'electronics', baseMultiplier: 1.3,
    importPropensity: .4, labourDemand: .7, energyDemand: 1.5, potentialGdpEffect: .8, capitalEffect: 1, implementationLag: 3 }),
  policy('grid', '送電網投資', { kind: 'growth', sector: 'construction', baseMultiplier: 1.2, labourDemand: 1,
    energyDemand: .3, potentialGdpEffect: .5, energyCapacityEffect: 1.5, implementationLag: 3 }),
  policy('generation', '発電設備投資', { kind: 'growth', sector: 'electricity', baseMultiplier: 1.2,
    importPropensity: .3, labourDemand: .7, energyDemand: .3, potentialGdpEffect: .5, energyCapacityEffect: 2, implementationLag: 3 }),
];

/** Per-leaf provenance; numeric computation objects remain ergonomic and serializable. */
export function assumptionRecords(data: unknown, prefix = ''): SourceValue[] {
  const leaf = prefix.split('.').at(-1) ?? '';
  const yenFields = ['nominalGdp', 'realGdp', 'potentialGdp', 'primaryBalance', 'structuralPrimaryBalance', 'taxRevenue',
    'primaryExpenditure', 'interestPayments', 'grossDebt', 'financialAssets', 'netDebt', 'liquidFinancialAssets',
    'liquidityAdjustedNetDebt', 'principal', 'importBill', 'exports', 'imports', 'tradeBalance', 'goodsBalance',
    'servicesBalance', 'primaryIncomeBalance', 'secondaryIncomeBalance', 'currentAccount', 'niip', 'essentialImports',
    'annualCost', 'searchCap', 'searchStep', 'searchTolerance'];
  const years = ['year', 'maturityYear', 'duration', 'implementationLag', 'newDebtMaturity'];
  const gw = ['firmCapacity', 'peakDemand', 'renewableInstalledCapacity', 'renewableFirmContribution'];
  if (typeof data === 'number') return [{ key: prefix, value: data,
    unit: prefix.startsWith('thresholds.') ? '比率（1 = 100%）' : yenFields.includes(leaf) ? '円' :
      years.includes(leaf) ? '年' : gw.includes(leaf) ? 'GW' :
      ['labourForce', 'employment', 'unemployment'].includes(leaf) ? '人' : leaf === 'hoursWorked' ? '時間/年' : '無次元（比率・指数・係数）',
    referenceYear: '試作年0', sourceName: 'モデル仮定（未検証）', sourceUrl: null, status: 'assumption',
    uncertaintyNote: '実測値ではありません。校正・信頼区間は未検証。感度を比較するための例示値です。' }];
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).flatMap(([key, value]) => assumptionRecords(value, prefix ? `${prefix}.${key}` : key));
}
