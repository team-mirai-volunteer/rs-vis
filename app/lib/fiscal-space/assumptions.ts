import type { EconomyState, ModelParameters, Policy, Sector, Shock, SourceValue, Thresholds } from '@/types/fiscal-space';
import { japanSources, japanValue, type JapanDataset } from './japan-data';
import { ELECTRICITY_BASELINE, electricityRecords } from './electricity-baseline';
import { DEMOGRAPHICS, demographicRecords } from './demographics';
import { INSURANCE_DEFAULTS } from './insurance-response';
import { buildDebtPortfolio } from './debt-portfolio';

export const TRILLION = 1e12;
export const SECTORS: Sector[] = ['general', 'construction', 'healthcare', 'research', 'electronics', 'electricity'];
export const SECTOR_LABELS: Record<Sector, string> = { general: '全産業', construction: '建設', healthcare: '医療', research: '研究', electronics: '電子・半導体', electricity: '電力' };
export const INPUT_LABELS = { capital: '設備', labour: '労働', energy: 'エネルギー', materials: '中間財' };
/** Future paths and response coefficients are scenarios, not observed statistics. */
export const PARAMETERS: ModelParameters = {
  // 比較用の初期値。税・社会負担全体の実証推定値ではない。1.7は感度比較。
  taxRevenueElasticity: 1.3, taxCollectionLag: 0,
  // 社会負担の弾性値。1994〜2024年度の1年変化の事後推定は0.77〜0.87（docs/fiscal-space-macro-backtest.md）。
  // 保険料率引上げ・高齢化トレンドは1年変化では捉えられないため、比較用の初期値は1.0（GDP比一定）とする。
  socialContributionElasticity: 1.0,
  demographics: { ...DEMOGRAPHICS },
  productionModel: 'leontief', gapDemandSensitivity: 3, gapPriceSensitivity: 5, gapInflationSlope: .05,
  // 構造的失業率2.5%は日本のNAIRU推定幅（約2.3〜2.7%）の中央付近を置いた仮定。推定値ではない。
  structuralUnemployment: .025, inflationRule: 'peak',
  consumptionTax: { revenuePerPoint: 3.5e12, cpiShare: .85, baseRate: .10, passThrough: 1, referenceDirectCpi: .78, referenceDirectDeflator: .5 },
  electricity: { ...ELECTRICITY_BASELINE },
  referenceModel: 'ef2026', multiplierScale: 1,
  insurance: { ...INSURANCE_DEFAULTS }, macroTailYears: 5,
  hoursElasticity: 0, participationElasticity: 0, netLabourIncomeShare: .4,
  employeeReliefShare: .5, employerDemandElasticity: 0, employerLabourCostShare: .55,
  baselineRealGrowth: .01, baselineInflation: .02, marketRate: .02, newDebtMaturity: 10,
  stockFlowAdjustmentRatio: 0,
  overflowImportShare: .4, inflationPassThrough: 1.4, inflationPersistence: .25,
  energyPricePassThrough: .25, investmentDepreciation: .03, goodsImportShare: .75,
  energyDomesticPricePassThrough: .5, expenditurePriceIndexation: 1,
  capacityPriceSensitivity: .005, capacityPressureStart: .85, referenceCapacityRatio: 1.10,
  essentialImportShare: .25, wageInflationPassThrough: .8, cesSigma: .8,
  weights: { capital: .3, labour: .4, energy: .15, materials: .15 },
  cobbWeights: { capital: .35, labour: .5, energy: .15 },
  // reserveShare 0: the displayed envelope is derived from selected stresses (stress-envelope.ts), not a percentage.
  searchCap: 100 * TRILLION, searchStep: TRILLION, searchTolerance: .01 * TRILLION, reserveShare: 0,
};
// labour: structural / actual unemployment ratio. 1.25 with u* = 2.5% permits unemployment down to 2.0%.
export const THRESHOLDS: Thresholds = { debt: 2.8, interestGdp: .065, interestTax: .3, gfn: .45,
  inflation: .025, capacity: .995, labour: 1.25, sector: 1, energy: .95, external: .3 };
/** Lowest unemployment rate the labour constraint permits. */
export const permittedUnemploymentFloor = (structuralUnemployment: number, labourThreshold: number) => structuralUnemployment / labourThreshold;
export const NO_SHOCK: Shock = { marketRateDelta: 0, energyPriceChange: 0, realGrowthDelta: 0 };
export function initialEconomy(dataset: JapanDataset = '2024'): EconomyState {
  const J = (key: string) => japanValue(key, dataset);
  const gdp = J('macro.nominalGdp'), debt = J('fiscal.grossDebt');
  const interest = J('fiscal.interestPayments');
  return {
    year: 0, baseCalendarYear: dataset === 'latest' ? 2026 : 2024,
    macro: { nominalGdp: gdp, realGdp: J('macro.realGdp'), potentialGdp: J('macro.potentialGdp'), inflation: J('macro.inflation'),
      coreInflation: J('macro.coreInflation'), expectedInflation: .02, nominalWageGrowth: .03,
      realGrowth: J('macro.realGrowth'), nominalGrowth: J('macro.nominalGrowth') },
    fiscal: { primaryBalance: J('fiscal.primaryBalance'), structuralPrimaryBalance: J('fiscal.structuralPrimaryBalance'),
      taxRevenue: J('fiscal.taxRevenue'), taxes: J('fiscal.taxes'), socialContributions: J('fiscal.socialContributions'), primaryExpenditure: J('fiscal.primaryExpenditure'), interestPayments: interest,
      interestRevenue: J('fiscal.interestRevenue'), otherPrimaryRevenue: J('fiscal.otherPrimaryRevenue'),
      grossDebt: debt, financialAssets: J('fiscal.financialAssets'), netDebt: J('fiscal.netDebt'),
      liquidFinancialAssets: J('fiscal.liquidFinancialAssets'), liquidityAdjustedNetDebt: J('fiscal.liquidityAdjustedNetDebt') },
    // Published JGB redemption schedule plus a residual ladder, reconciled to gross debt and interest paid.
    debtPortfolio: buildDebtPortfolio(debt, interest).buckets,
    production: { inputs: { capital: 1.18, labour: 1.08, energy: 1.12, materials: 1.2 }, tfp: 1, labourProductivity: 1 },
    labour: { labourForce: J('labour.labourForce'), employment: J('labour.employment'), unemployment: J('labour.unemployment'), hoursWorked: 1700,
      participation: J('labour.participation'), wageGrowth: .03,
      sectorUtilization: { general: .87, construction: .94, healthcare: .92, research: .8, electronics: .88, electricity: .89 } },
    energy: { primaryDemand: J('energy.primaryDemand'), domesticSupply: J('energy.domesticSupply'), importedEnergy: J('energy.importedEnergy'), fossilFuelImportDependency: .95,
      firmCapacity: 200, peakDemand: 170, reserveMargin: 30 / 170, importBill: J('energy.importBill'),
      renewableInstalledCapacity: 100, renewableFirmContribution: 20 },
    external: { exports: J('external.exports'), imports: J('external.imports'), tradeBalance: J('external.tradeBalance'),
      goodsBalance: J('external.goodsBalance'), servicesBalance: J('external.servicesBalance'), primaryIncomeBalance: J('external.primaryIncomeBalance'),
      secondaryIncomeBalance: J('external.secondaryIncomeBalance'), currentAccount: J('external.currentAccount'), niip: J('external.niip'),
      termsOfTrade: 1, essentialImports: 40 * TRILLION }, resilience: {},
  };
}

const policy = (id: string, name: string, overrides: Partial<Policy>): Policy => ({
  id, name, kind: 'temporary', channel: 'expenditure', sector: 'general', annualCost: TRILLION,
  duration: 3, energyDemand: 0, potentialGdpEffect: 0, implementationLag: 0,
  capitalEffect: 0, tfpEffect: 0, energyCapacityEffect: 0, labourProductivityEffect: 0, ...overrides,
});
/** Unidentified sector-specific capital/productivity yields are not credited by default.
 * Demand responses and their explicitly documented proxies live in calibration.ts. */
export const POLICIES: Policy[] = [
  policy('income-tax', '所得税減税', { channel: 'tax', kind: 'permanent' }),
  policy('resident-tax', '住民税減税', { channel: 'tax', kind: 'permanent' }),
  policy('consumption-tax', '消費税減税', { channel: 'tax', kind: 'permanent' }),
  policy('social-insurance', '社会保険料減税', { channel: 'tax', kind: 'permanent' }),
  policy('cash', '現金給付', {}),
  policy('public-investment', '公共投資', { kind: 'growth', sector: 'construction' }),
  policy('defence', '防衛', {}),
  policy('healthcare', '医療', { sector: 'healthcare' }),
  policy('childcare', '子育て', { kind: 'permanent' }),
  policy('education', '教育', { kind: 'growth' }),
  policy('rd', '研究開発', { kind: 'growth', sector: 'research' }),
  policy('semiconductors', '半導体・産業投資', { kind: 'growth', sector: 'electronics' }),
  policy('grid', '送電網投資', { kind: 'growth', sector: 'construction' }),
  policy('generation', '発電設備投資', { kind: 'growth', sector: 'electricity' }),
];

/** Per-leaf provenance; numeric computation objects remain ergonomic and serializable. */
export function assumptionRecords(data: unknown, prefix = '', dataset: JapanDataset = '2024'): SourceValue[] {
  // Estimated vectors have explicit units and provenance in resourceRecords.
  if (prefix === 'parameters.resourceModel' || (prefix.startsWith('policies.') && prefix.endsWith('.load') &&
    data && typeof data === 'object' && 'estimated' in data && data.estimated)) return [];
  if (prefix === 'parameters.electricity') return electricityRecords(data as ModelParameters['electricity']);
  if (prefix === 'parameters.demographics') return demographicRecords(data as ModelParameters['demographics'], dataset === 'latest' ? 2026 : 2024);
  // The maturity ladder has its own provenance records (debtPortfolioRecords); leaf values would only repeat them.
  if (prefix.startsWith('initial.debtPortfolio')) return [];
  // Project fields have their own units and provenance in policyTradeRecords.
  if (prefix.startsWith('policies.') && prefix.endsWith('.trade')) return [];
  if (prefix.startsWith('policies.') && prefix.endsWith('.supply')) return [];
  const leaf = prefix.split('.').at(-1) ?? '';
  const yenFields = ['nominalGdp', 'realGdp', 'potentialGdp', 'primaryBalance', 'structuralPrimaryBalance', 'taxRevenue', 'taxes', 'socialContributions',
    'primaryExpenditure', 'interestPayments', 'grossDebt', 'financialAssets', 'netDebt', 'liquidFinancialAssets',
    'liquidityAdjustedNetDebt', 'principal', 'importBill', 'exports', 'imports', 'tradeBalance', 'goodsBalance',
    'servicesBalance', 'primaryIncomeBalance', 'secondaryIncomeBalance', 'currentAccount', 'niip', 'essentialImports',
    'annualCost', 'searchCap', 'searchStep', 'searchTolerance', 'interestRevenue', 'otherPrimaryRevenue'];
  const years = ['year', 'maturityYear', 'duration', 'implementationLag', 'newDebtMaturity', 'taxCollectionLag'];
  const gw = ['firmCapacity', 'peakDemand', 'renewableInstalledCapacity', 'renewableFirmContribution'];
  if (typeof data === 'number') {
    const source = japanSources(dataset)[prefix];
    if (source) {
      const unchanged = Math.abs(data - source.value) <= Math.max(1, Math.abs(source.value)) * 1e-12;
      return [{ ...source, value: data, ...(unchanged ? {} : { status: 'assumption' as const,
        sourceName: `シナリオ設定（基準：${source.sourceName}）`,
        uncertaintyNote: `公表実績・基準値から変更した入力です。${source.uncertaintyNote}` }) }];
    }
    const omittedPolicyEffect = prefix.startsWith('policies.') && ['energyDemand', 'potentialGdpEffect', 'capitalEffect', 'tfpEffect', 'energyCapacityEffect', 'labourProductivityEffect'].includes(leaf) && data === 0;
    return [{ key: prefix, value: data,
    unit: leaf === 'budgetTrillion' ? '年0価格・兆円' :
      ['workerYears', 'sectorWorkerCapacity'].includes(leaf) ? '人年' :
      ['constructionPeakMw', 'operatingPeakMw'].includes(leaf) ? 'MW' :
      leaf === 'annualOperatingGwh' ? 'GWh/年' :
      leaf === 'revenuePerPoint' ? '円/税率1%ポイント' :
      ['referenceDirectCpi', 'referenceDirectDeflator'].includes(leaf) ? '%/税率1%ポイント' :
      ['peakGwPerTrillion', 'operatingPeakGwPerTrillion'].includes(leaf) ? 'GW/年0価格1兆円' :
      ['annualGwhPerTrillion', 'operatingAnnualGwhPerTrillion'].includes(leaf) ? 'GWh/年0価格1兆円' :
      leaf === 'annualConstructionGwh' ? 'GWh/年' :
      leaf === 'sectorUtilizationPerTrillion' ? '稼働率の増分/年0価格1兆円' :
      ['lag', 'lifetime', 'years', 'adjustmentYears', 'macroTailYears'].includes(leaf) ? '年' :
      prefix.startsWith('thresholds.') ? '比率（1 = 100%）' : yenFields.includes(leaf) ? '円' :
      years.includes(leaf) ? '年' : gw.includes(leaf) ? 'GW' :
      ['labourForce', 'employment', 'unemployment'].includes(leaf) ? '人' : leaf === 'hoursWorked' ? '時間/年' : '無次元（比率・指数・係数）',
    referenceYear: prefix.startsWith('initial.') ? '選択した初期状態の仮定' : 'シナリオ設定', sourceName: omittedPolicyEffect ? '未同定の効果は加算しない設定' : 'モデル仮定（未検証）', sourceUrl: null, status: 'assumption',
    uncertaintyNote: omittedPolicyEffect ? '分野・事業設計別の実証校正が未実施のため未算入です。効果がゼロと推定されたという意味ではありません。' : prefix.startsWith('initial.debtPortfolio.')
      ? '債務総額と利払額は実績に合わせていますが、満期1〜10年への均等配分と一律の表面利率は仮定です。実際の償還予定ではありません。'
      : '実測値ではありません。政策係数・将来経路・供給能力・閾値などの感度を比較するための設定です。' }];
  }
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).flatMap(([key, value]) => assumptionRecords(value, prefix ? `${prefix}.${key}` : key, dataset));
}
