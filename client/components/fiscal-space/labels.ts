import type { Policy } from '@/types/fiscal-space';
import { INPUT_LABELS, SECTOR_LABELS } from '@/app/lib/fiscal-space/assumptions';
import { CONSTRAINTS } from '@/app/lib/fiscal-space/constraints';

const LABELS: Record<string, string> = {
  generationTwh: '基準発電量', thermalShare: '基準火力割合', demandGrowth: '電力需要増加率', peakGrowth: 'ピーク需要増加率', nonThermalDecline: '既存非化石発電量の減少率', plannedNonThermalTwh: '既定の非化石発電年間追加量', fuelImportYenPerKwh: '火力燃料輸入単価',
  powerMix: '電源構成', solar: '太陽光', nuclear: '原子力', hydro: '水力',
  maintenanceRate: '年間保守費率', maintenanceImportShare: '保守費の輸入割合', generationOverlapShare: '追加再エネと重複し得る便益',
  energyCpi: 'エネルギーCPI', exchangeRate: '為替レート（円／ドル）',
  ureaDomesticShare: '肥料原料・尿素の国産割合',
  context: '参考統計', coreCoreCpi: 'コアコアCPI', foodCpi: '食料CPI', calorieSelfSufficiency: '食料自給率（カロリー）',
  valueSelfSufficiency: '食料自給率（生産額）', oecdGrossLiabilities: 'OECD平均・総金融負債GDP比', oecdJapanGrossLiabilities: 'OECD定義の日本・総金融負債GDP比',
  calibration: '公表モデルの反応', government: '政府支出増', governmentOneYear: '政府支出増（1年限り）', household: '所得税減税', corporate: '法人税減税',
  gdp: '実質GDP', prices: '消費者物価水準', deflator: 'GDPデフレーター', hours: '労働時間',
  multiplierScale: 'GDP乗数の感度倍率', hoursElasticity: '手取り賃金に対する労働時間の弾力性',
  participationElasticity: '手取り賃金に対する参加の弾力性', netLabourIncomeShare: '本人の手取り労働所得のGDP比',
  employeeReliefShare: '社会保険料軽減の本人配分', employerDemandElasticity: '雇用コストに対する需要の弾力性', employerLabourCostShare: '事業主の総雇用コストのGDP比',
  ...INPUT_LABELS, ...SECTOR_LABELS,
  initial: '初期状態', parameters: 'モデル係数', policies: '政策', thresholds: '許容上限',
  shock: '外部環境の変化', allocationWeights: '政策の配分比',
  macro: '経済全体', fiscal: '財政', debtPortfolio: '債務の満期構成', production: '生産能力',
  external: '対外収支', inputs: '投入量', sectorUtilization: '産業別利用率', year: '経過年',
  nominalGdp: '名目GDP', realGdp: '実質GDP', potentialGdp: '潜在GDP', inflation: 'インフレ率',
  coreInflation: '生鮮食品を除く物価上昇率', expectedInflation: '期待インフレ率',
  nominalWageGrowth: '名目賃金上昇率', realGrowth: '実質成長率', nominalGrowth: '名目成長率',
  primaryBalance: '基礎的財政収支', structuralPrimaryBalance: '構造的基礎的財政収支',
  taxRevenue: '税・社会負担収入', primaryExpenditure: '利払いを除く歳出',
  interestPayments: '支払利子', interestRevenue: '受取利子', otherPrimaryRevenue: 'その他の非利子収入',
  grossDebt: '総債務', financialAssets: '純債務の控除対象資産', netDebt: '純債務',
  liquidFinancialAssets: '流動性の高い金融資産', liquidityAdjustedNetDebt: '流動性調整純債務',
  principal: '元本', coupon: '表面利率', maturityYear: '満期年',
  tfp: '全要素生産性', labourProductivity: '労働生産性', labourForce: '労働力人口',
  employment: '就業者数', unemployment: '完全失業者数', hoursWorked: '年間労働時間',
  participation: '労働参加率', wageGrowth: '賃金上昇率',
  primaryDemand: '一次エネルギー需要', domesticSupply: '国内エネルギー供給',
  importedEnergy: '海外依存エネルギー', fossilFuelImportDependency: '化石燃料輸入依存率',
  firmCapacity: '確実電力供給', peakDemand: '最大電力需要', reserveMargin: '電力予備率',
  importBill: 'エネルギー輸入費', renewableInstalledCapacity: '再エネ設備容量',
  renewableFirmContribution: '再エネ確実供給寄与', exports: '財・サービス輸出', imports: '財・サービス輸入',
  tradeBalance: '財・サービス収支', goodsBalance: '財の収支', servicesBalance: 'サービス収支',
  primaryIncomeBalance: '第一次所得収支', secondaryIncomeBalance: '第二次所得収支',
  currentAccount: '経常対外収支', niip: '対外純資産', termsOfTrade: '交易条件', essentialImports: '必需輸入費',
  annualCost: '年間追加費用', duration: '支出期間', baseMultiplier: '基礎乗数', importPropensity: '輸入性向',
  inflationSensitivity: '物価感応度', labourDemand: '追加労働需要係数', energyDemand: '追加エネルギー需要係数',
  potentialGdpEffect: '潜在GDPへの効果', implementationLag: '効果が現れるまでの年数',
  capitalEffect: '設備への効果', tfpEffect: '全要素生産性への効果', energyCapacityEffect: '電力供給能力への効果',
  labourProductivityEffect: '労働生産性への効果', baselineRealGrowth: '将来の基準実質成長率',
  baselineInflation: '将来の基準インフレ率', marketRate: '市場金利', newDebtMaturity: '新発債の満期',
  stockFlowAdjustmentRatio: '残高調整のGDP比', gapMultiplierSensitivity: '潜在GDP余力の乗数感応度',
  slackMultiplierSensitivity: '最大GDP余力の乗数感応度', supplySlackReference: '全国供給余力の基準',
  sectorSlackReference: '産業供給余力の基準', minimumCapacityFactor: '能力係数の下限',
  overflowImportShare: '国内供給超過分の輸入割合', inflationPassThrough: '需要圧力の物価転嫁率',
  inflationPersistence: 'インフレの持続率', energyPricePassThrough: 'エネルギー価格の転嫁率',
  investmentDepreciation: '投資効果の減耗率', goodsImportShare: '追加輸入に占める財の割合',
  essentialImportShare: '追加輸入に占める必需品の割合', wageInflationPassThrough: '物価の賃金への波及率',
  cesSigma: '投入要素の代替弾力性', weights: '代替弾力性一定モデルの投入比重',
  cobbWeights: 'コブ＝ダグラス型の投入比重', searchCap: '探索上限額', searchStep: '探索間隔',
  searchTolerance: '境界探索の分解能', reserveShare: '緊急時留保率',
  marketRateDelta: '市場金利の変化幅', energyPriceChange: '輸入エネルギー価格の変化率', realGrowthDelta: '実質成長率の変化幅',
};

/** Translate display names only; keep source keys and model identifiers stable. */
export function inputLabel(key: string, policies: Policy[]): string {
  const tradeLabels: Record<string, string> = { importFxExposure: '輸入価格への円安転嫁', exportFxExposure: '輸出受取の円換算割合', cpiPass: 'CPI水準への転嫁', foodPass: '食品価格水準への転嫁',
    annualSalesPerInvestment: '投資あたり年間売上', capexImportShare: '建設費の輸入割合', exportShare: '売上の輸出割合', domesticReplacementShare: '国内販売の輸入置換割合', operatingImportShare: '輸入原価割合',
    lag: '稼働までの年数', lifetime: '便益期間', capexPerKw: '設備容量あたり建設費', capacityFactor: '設備利用率', curtailment: '出力制御率', thermalReplacement: '火力置換割合',
    displacedFuelYenPerKwh: '置換燃料単価', operatingImportYenPerKwh: '運転時輸入単価', firmShare: '確実供給寄与率' };
  if (key.startsWith('externalStress.')) return `為替ストレス / ${tradeLabels[key.split('.')[1]] ?? '未分類'}`;
  if (key.startsWith('supply.')) {
    const labels: Record<string, string> = { additionality: '純追加性', lag: '効果までの年数', depreciation: '年間減耗率', lifetime: '効果期間', yield: '効果係数', unitCost: '単位費用・基準資本比', employment: '就労・常勤換算' };
    return `供給力 / ${policies.find(p => p.id === key.split('.')[1])?.name ?? key.split('.')[1]} / ${labels[key.split('.')[2]] ?? LABELS[key.split('.')[2]] ?? '未分類'}`;
  }
  if (key.startsWith('policyTrade.powerMix.')) { const parts = key.split('.'); return parts[2] === 'weights' ? `発電投資の配分重み / ${LABELS[parts[3]]}` : `電源別条件 / ${LABELS[parts[2]]} / ${tradeLabels[parts[3]] ?? '未分類'}`; }
  if (key.startsWith('policyTrade.') && ['additionality', 'depreciation'].includes(key.split('.')[2])) return `事業別試算 / ${policies.find(p => p.id === key.split('.')[1])?.name} / ${key.endsWith('additionality') ? '純追加性' : '年間減耗率'}`;
  if (key.startsWith('policyTrade.')) return `事業別試算 / ${key.split('.')[1] === 'power' ? '発電方式' : policies.find(p => p.id === key.split('.')[1])?.name} / ${tradeLabels[key.split('.')[2]] ?? '未分類'}`;
  if (key.startsWith('burden.national.')) return `国民負担率（${key.endsWith('.ni') ? 'NI比・参考' : 'GDP比'}） / ${key.split('.')[2]}年度${key.endsWith('.tax') ? ' / 租税（概算）' : key.endsWith('.social') ? ' / 社会保障（概算）' : ''}`;
  if (key === 'burden.household.average') return '現役世帯の平均家計負担率（負担総額÷所得総額）';
  if (key.startsWith('burden.weight.')) return `勤労者世帯の抽出率調整済み分布 / 第${Number(key.split('.')[2]) + 1}年齢階級`;
  if (key.startsWith('burden.oecd.')) return `OECDの勤労世帯比較 / ${key.split('.')[2] === 'single' ? '単身・子なし' : '片働き夫婦・子2人'} / ${key.endsWith('.japan') ? '日本' : 'OECD平均'}`;
  if (key.startsWith('burden.household.')) return `年齢別家計負担率 / ${key.split('.')[2] === '0' ? '勤労者世帯' : '無職世帯'} / 第${Number(key.split('.')[3]) + 1}年齢階級`;
  if (key === 'burden.employerRate') return '家計負担推計 / 事業主負担の換算料率';
  if (key === 'burden.corporateShare') return '家計負担推計 / 法人税の賃金帰着割合';
  if (key === 'burden.corporateTaxTotal') return '家計負担推計 / 国・地方の法人課税総額';
  if (key === 'burden.wagesAndSalaries') return '家計負担推計 / 全国の賃金・俸給';
  const parts = key.split('.');
  if (parts[0] === 'thresholds') {
    return `許容上限 / ${CONSTRAINTS.find(c => c.id === parts[1])?.label ?? '未分類'}`;
  }
  return parts.map((part, index) => {
    if (parts[index - 1] === 'policies') return policies[Number(part)]?.name ?? `政策${Number(part) + 1}`;
    if (parts[index - 1] === 'allocationWeights') return policies.find(p => p.id === part)?.name ?? '未分類の政策';
    if (/^\d+$/.test(part)) return `第${Number(part) + 1}区分`;
    return LABELS[part] ?? '未分類の入力';
  }).join(' / ');
}
