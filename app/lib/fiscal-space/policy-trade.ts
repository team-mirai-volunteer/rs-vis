import type { Policy, SourceValue } from '@/types/fiscal-space';
import industryReference from './data/industry-trade-reference.json';
import projectImportReference from './data/project-import-reference.json';
export const PROJECT_IMPORT_REFERENCE = projectImportReference;
export const PROJECT_IMPORT_NOTE = `建設・導入費の輸入割合の初期値${(projectImportReference.capexImportShare * 100).toFixed(1)}%は、2020年全国産業連関表の固定資本形成から概算（直接輸入${(projectImportReference.directImportShare * 100).toFixed(1)}%＋国内供給網の輸入${(projectImportReference.upstreamImportShare * 100).toFixed(1)}%）。負の純処分額を除いた調達構成を使用し、関税・輸入品商品税は除外。半導体・研究開発・各電源に全国平均を代用する仮置きで、分野別の実測値ではありません。`;
export const RESEARCH_PROJECT_SOURCE = 'https://www.rieti.go.jp/jp/publications/pdp/13p010.pdf';
export const RESEARCH_PROJECT_NOTE = '研究開発の年間売上/投資額は0.6円で仮置き。既存の供給モデルが参考にする研究開発収益率30%を、輸出50%＋国内販売50%×輸入置換50%−輸入原価25%＝純寄与50%という仮定で割った逆算値です。売上や輸出割合の実測推定ではありません。純追加性50%、稼働3年後、減耗15%、便益20年を仮定。知識蓄積の供給効果とは加算せず、この事業経路へ切り替えます。';
export const INDUSTRY_TRADE_REFERENCE = industryReference;
/** Percent text for the IO benchmark so UI, provenance and docs never drift from the JSON. */
export const INDUSTRY_TRADE_REFERENCE_PERCENT = {
  exportShare: (industryReference.exportShare * 100).toFixed(1),
  domesticReplacementShare: (industryReference.domesticReplacementShare * 100).toFixed(1),
  operatingImportShare: (industryReference.operatingImportShare * 100).toFixed(1),
  directOperatingImportShare: (industryReference.directOperatingImportShare * 100).toFixed(1),
};
const IO_REFERENCE_KEYS = ['exportShare', 'domesticReplacementShare', 'operatingImportShare'];

export const SEMICONDUCTOR_SOURCE = 'https://www.meti.go.jp/policy/mono_info_service/ai_semiconductor_frame/ai_semiconductor_frame.html';
export const POWER_SOURCE = 'https://www.enecho.meti.go.jp/committee/council/basic_policy_subcommittee/mitoshi/cost_wg/pdf/cost_wg_20250206_02.pdf';
export const POWER_DETAIL_SOURCE = 'https://www.enecho.meti.go.jp/committee/council/basic_policy_subcommittee/mitoshi/cost_wg/pdf/cost_wg_20250206_01.pdf';
export const POWER_CONSTRUCTION_SOURCE = 'https://www.enecho.meti.go.jp/about/whitepaper/2025/html/1-2-2.html';
export const SOLAR_LAG_NOTE = '太陽光は支出から1年後（初回は2年目）に稼働する短期導入ケースを初期設定とします。エネルギー白書2025の建設期間の例は1〜4年で、1年は平均値ではありません。用地・許認可・系統接続を含む案件の条件に合わせて変更してください。';

/** Mechanisms are policy-specific. Missing causal magnitudes are not estimated zeros. */
export const POLICY_TRADE_CHANNELS: Record<string, { exports: string; substitution: string; imports: string; timing: string }> = {
  'income-tax': { exports: '就労・人材供給を通じた競争力。直接の輸出支援ではない', substitution: '国産・輸入の購入比率と国内供給次第', imports: '手取り増による消費財・原材料需要', timing: '需要は早期、供給反応は税率設計次第' },
  'resident-tax': { exports: '本人の負担軽減による就労・人材供給を通じた競争力', substitution: '国産・輸入の購入比率と国内供給次第', imports: '手取り増による消費財・原材料需要。所得税減税の反応を代用', timing: '入力した減収年から軽減。課税・徴収時期の違いは未反映' },
  'social-insurance': { exports: '事業主負担減→雇用費用低下→輸出価格・生産能力', substitution: '国内生産費の低下が国産品の競争力を改善し得る', imports: '本人負担減による輸入需要、増産時の原材料', timing: '賃金転嫁と雇用調整の時間を要する' },
  'consumption-tax': { exports: '輸出免税・仕入税還付と仕入税負担を相殺して考える', substitution: '国内消費に対する国産品・輸入品への課税をともに変更', imports: '実質購買力の回復による輸入需要', timing: '価格転嫁・駆け込み反動と需要回復を分ける' },
  cash: { exports: '販路や生産設備への直接効果は限定的', substitution: '給付対象者の購入先と国内の供給余力次第', imports: '耐久財・食品等の購入増', timing: '給付・消費時に需要が発生' },
  'public-investment': { exports: '港湾・物流設備なら輸出費用を低下させ得る', substitution: '国内物流・生産基盤の改善。工事内容で異なる', imports: '建設機械・鉄鋼原料・燃料', timing: '建設時の需要と供用後の便益を分離' },
  defence: { exports: '国内装備の輸出は制度・契約・受注条件次第', substitution: '装備・部品の国産化。輸入完成品の調達とは別', imports: '海外製装備・部品の調達は直接輸入', timing: '契約・納入・国産開発の期間を分離' },
  healthcare: { exports: '医薬品・医療機器の開発と、国内診療への支出を分ける', substitution: '医薬品・機器の国内製造。診療費増だけでは生じない', imports: '薬品・機器・原料の調達', timing: '診療と製品開発・承認の時間が異なる' },
  childcare: { exports: '保育による就労継続が間接的に生産を支える', substitution: '保育サービス自体と輸入代替を混同しない', imports: '施設・物品、可処分所得増に伴う購入', timing: '保育人材・施設の確保後に就労反応' },
  education: { exports: '人材・留学生向け教育サービス等。支出内容次第', substitution: '技能向上による国内供給。教育費だけからは換算できない', imports: '教材・機器・海外ソフトウェア', timing: '技能形成・就業までの長期の遅れ' },
  rd: { exports: '製品・特許使用料・技術サービスの海外販売', substitution: '技術開発による国産化。成功確率・権利帰属が重要', imports: '研究機器・試薬・海外サービス', timing: '研究→実証→量産・事業化の遅れ' },
  semiconductors: { exports: '国内工場で製造した半導体の海外販売', substitution: '国内需要に適合する品種・工程の輸入を置換', imports: '建設時の製造装置、稼働後の部素材・エネルギー', timing: '建設→歩留まり改善→量産。先端・成熟品種で異なる' },
  grid: { exports: '電力そのものの輸出は想定せず、産業立地を支える', substitution: '出力制御・送電損失の減少による燃料節約', imports: '電力機器・金属・建設資材', timing: '供用後。発電投資と同じ節約量を二重計上しない' },
  generation: { exports: '国内発電量を輸出増とはみなさない', substitution: '太陽光・原子力・水力別に火力燃料の輸入を置換', imports: '方式別の建設設備・核燃料等', timing: '建設期間と設備利用率・出力制御を区別' },
};

export interface IndustryTradeCase {
  additionality?: number; depreciation?: number;
  annualSalesPerInvestment: number | null;
  capexImportShare: number | null;
  exportShare: number; domesticReplacementShare: number; operatingImportShare: number;
  lag: number; lifetime: number;
}
export const INDUSTRY_CASE: IndustryTradeCase = { annualSalesPerInvestment: null, capexImportShare: null,
  exportShare: .5, domesticReplacementShare: .5, operatingImportShare: .25, lag: 3, lifetime: 10 };

// Calibrate net operating contribution to the existing research scenario, not gross sales to GDP.
export const RESEARCH_CASE: IndustryTradeCase = { ...INDUSTRY_CASE,
  annualSalesPerInvestment: .3 / (.5 + (1 - .5) * .5 - .25),
  capexImportShare: projectImportReference.capexImportShare,
  additionality: .5, depreciation: .15, lifetime: 20 };

export const SEMICONDUCTOR_FINANCIAL_SOURCE = 'https://investor.tsmc.com/sites/ir/financial-report/2024/TSMC%202024Q4%20Consolidated%20Financial%20Statements_E_1.pdf';
// TSMC 2024 revenue / year-end net PPE (both NT$ thousand), not sales / annual capex.
// This is a foreign firm benchmark, not the causal return on a Japanese subsidy.
export const SEMICONDUCTOR_CASE: IndustryTradeCase = { ...INDUSTRY_CASE,
  capexImportShare: projectImportReference.capexImportShare,
  exportShare: industryReference.exportShare,
  domesticReplacementShare: industryReference.domesticReplacementShare,
  operatingImportShare: industryReference.operatingImportShare,
  annualSalesPerInvestment: 2894307699 / 3234980070, additionality: .5, depreciation: .1, lifetime: 15 };

/** Operating imports fall only above this replacement fraction of domestic sales.
 * Excludes construction and induced demand. null means no domestic sales. */
export function industryImportBreakEven(c: IndustryTradeCase): number | null {
  return c.exportShare < 1 ? c.operatingImportShare / (1 - c.exportShare) : null;
}

type InvestmentSchedule = Pick<Policy, 'kind' | 'duration' | 'annualCost'>;
function paid(policy: InvestmentSchedule, year: number) { return policy.kind === 'permanent' || year <= policy.duration; }
function validateFractions(values: number[]) {
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new RangeError('Shares must be between 0 and 1');
}
function liveInvestment(policy: InvestmentSchedule, year: number, lag: number, lifetime: number, depreciation = 0) {
  if (![year, lag, lifetime].every(Number.isInteger) || year < 1 || lag < 0 || lifetime < 1 || policy.annualCost < 0 || !Number.isFinite(policy.annualCost)) throw new RangeError('Invalid project period or cost');
  let amount = 0;
  for (let y = 1; y <= year; y++) if (paid(policy, y) && year >= y + lag && year < y + lag + lifetime) amount += policy.annualCost * (1 - depreciation) ** (year - y - lag);
  return amount;
}

/** Direct project flows at fixed input prices. Never silently add these gross
 * flows to the reference multiplier: it already includes construction/imports. */
export function industryTrade(policy: Policy, year: number, c: IndustryTradeCase) {
  validateFractions([c.exportShare, c.domesticReplacementShare, c.operatingImportShare]);
  if (c.annualSalesPerInvestment !== null && (!Number.isFinite(c.annualSalesPerInvestment) || c.annualSalesPerInvestment < 0)) throw new RangeError('Invalid sales yield');
  if (c.capexImportShare !== null) validateFractions([c.capexImportShare]);
  validateFractions([c.additionality ?? 1, c.depreciation ?? 0]);
  const investment = liveInvestment(policy, year, c.lag, c.lifetime, c.depreciation ?? 0) * (c.additionality ?? 1);
  const sales = c.annualSalesPerInvestment === null ? null : investment * c.annualSalesPerInvestment;
  const capexImports = c.capexImportShare === null ? null : (paid(policy, year) ? policy.annualCost * c.capexImportShare : 0);
  const exports = sales === null ? null : sales * c.exportShare;
  const substitution = sales === null ? null : sales * (1 - c.exportShare) * c.domesticReplacementShare;
  const operatingImports = sales === null ? null : sales * c.operatingImportShare;
  const tradeBalance = exports === null || substitution === null || operatingImports === null || capexImports === null ? null : exports + substitution - operatingImports - capexImports;
  return { sales, exports, substitution, operatingImports, capexImports, tradeBalance,
    domesticValueAdded: sales === null ? null : sales * (1 - c.operatingImportShare) };
}

export type PowerTechnology = 'solar' | 'nuclear' | 'hydro';
// Editable scenario assumptions, not measured capacity credits or annual capacity factors.
export const POWER_FIRM_SHARES: Record<PowerTechnology, number> = { solar: .1, nuclear: .7, hydro: .5 };
export const POWER_FIRM_NOTE = '確実供給への寄与率は太陽光10%・原子力70%・水力50%を比較用の仮定として設定しています。設備利用率とは別の値で、実測・公的な認定値ではありません。稼働設備容量×寄与率を電力供給能力へ加算します。空欄の電源は供給力の増加を未算入とします。';
/** Public model-plant assumptions, not current project bids. Construction lags,
 * dispatch, import shares and firm capacity are separate scenario assumptions. */
export const POWER_TECHNOLOGIES = {
  solar: { name: '太陽光（事業用・50kW以上）', capexPerKw: 176000, capacityFactor: .183, auxiliaryRate: 0, lifetime: 25,
    lag: 1, note: '変動電源。夜間・悪天候、出力制御、蓄電・系統増強を考慮。設備費10.8万円/kWをすべて輸入額とはみなさない。' },
  nuclear: { name: '原子力（新設）', capexPerKw: 600250, capacityFactor: .70, auxiliaryRate: .04, lifetime: 40,
    lag: 10, note: '建設45.8万円/kW＋追加安全対策1,707億円÷120万kW。再稼働・建替えとは異なる。核燃料・審査・廃炉・事故対応費を別途考慮。' },
  hydro: { name: '水力（中水力・新設）', capexPerKw: 665000, capacityFactor: .547, auxiliaryRate: .004, lifetime: 40,
    lag: 5, note: '立地・水量制約が大きい。揚水は蓄電設備なのでこの方式には含めない。既設改修・小水力とは建設費が異なる。' },
} as const;
export interface PowerCase {
  mix?: { share: number; assumptions: PowerCase }[];
  technology: PowerTechnology; capexPerKw: number; capacityFactor: number; lag: number;
  curtailment: number; thermalReplacement: number; displacedFuelYenPerKwh: number;
  operatingImportYenPerKwh: number | null; capexImportShare: number | null; firmShare: number | null;
}
export function powerCase(technology: PowerTechnology): PowerCase {
  const t = POWER_TECHNOLOGIES[technology];
  return { technology, capexPerKw: t.capexPerKw, capacityFactor: t.capacityFactor, lag: t.lag,
    curtailment: 0, thermalReplacement: .8, displacedFuelYenPerKwh: 9,
    operatingImportYenPerKwh: technology === 'nuclear' ? .95 : 0, capexImportShare: projectImportReference.capexImportShare, firmShare: POWER_FIRM_SHARES[technology] };
}
/** Investment shares, not generation shares. Zero allocations have no effect. */
export function powerComponents(c: PowerCase): { share: number; assumptions: PowerCase }[] {
  if (!c.mix) return [{ share: 1, assumptions: c }];
  if (!c.mix.length || c.mix.some(x => x.assumptions.mix || !Number.isFinite(x.share) || x.share < 0)) throw new RangeError('Invalid power mix');
  const total = c.mix.reduce((sum, x) => sum + x.share, 0);
  if (total <= 0) throw new RangeError('Power mix needs a positive allocation');
  return c.mix.filter(x => x.share > 0).map(x => ({ ...x, share: x.share / total }));
}
export interface PowerTradeResult {
  capacityGw: number; generationTwh: number; substitution: number; exports: number;
  operatingImports: number | null; capexImports: number | null; firmGw: number | null; tradeBalance: number | null;
}
export function powerTrade(policy: InvestmentSchedule, year: number, c: PowerCase): PowerTradeResult {
  if (c.mix) {
    const rows = powerComponents(c).map(x => powerTrade({ ...policy, annualCost: policy.annualCost * x.share }, year, x.assumptions));
    const sum = (key: keyof typeof rows[number]) => rows.some(r => r[key] === null) ? null : rows.reduce((v, r) => v + r[key]!, 0);
    return { capacityGw: sum('capacityGw')!, generationTwh: sum('generationTwh')!, substitution: sum('substitution')!, exports: 0,
      operatingImports: sum('operatingImports'), capexImports: sum('capexImports'), firmGw: sum('firmGw'), tradeBalance: sum('tradeBalance') };
  }
  const t = POWER_TECHNOLOGIES[c.technology];
  if (!t || !Number.isFinite(c.capexPerKw) || c.capexPerKw <= 0 || !Number.isFinite(c.displacedFuelYenPerKwh) || c.displacedFuelYenPerKwh < 0) throw new RangeError('Invalid power cost');
  validateFractions([c.capacityFactor, c.curtailment, c.thermalReplacement]);
  if (c.capexImportShare !== null) validateFractions([c.capexImportShare]);
  if (c.firmShare !== null) validateFractions([c.firmShare]);
  if (c.operatingImportYenPerKwh !== null && (!Number.isFinite(c.operatingImportYenPerKwh) || c.operatingImportYenPerKwh < 0)) throw new RangeError('Invalid fuel import cost');
  const capacityKw = liveInvestment(policy, year, c.lag, t.lifetime) / c.capexPerKw;
  const generationKwh = capacityKw * 8760 * c.capacityFactor * (1 - t.auxiliaryRate) * (1 - c.curtailment);
  const substitution = generationKwh * c.thermalReplacement * c.displacedFuelYenPerKwh;
  const operatingImports = c.operatingImportYenPerKwh === null ? null : generationKwh * c.operatingImportYenPerKwh;
  const capexImports = c.capexImportShare === null ? null : (paid(policy, year) ? policy.annualCost * c.capexImportShare : 0);
  return { capacityGw: capacityKw / 1e6, generationTwh: generationKwh / 1e9, substitution, exports: 0,
    operatingImports, capexImports, firmGw: c.firmShare === null ? null : capacityKw / 1e6 * c.firmShare,
    tradeBalance: operatingImports === null || capexImports === null ? null : substitution - operatingImports - capexImports };
}

export function policyTradeRecords(value: { industry: Record<string, IndustryTradeCase>; power: PowerCase; mix?: Record<PowerTechnology, number>; powerCases?: Record<PowerTechnology, PowerCase> }): SourceValue[] {
  const groups = [...Object.entries(value.industry).map(([id, settings]) => ({ key: `policyTrade.${id}`, settings, source: id === 'semiconductors' ? SEMICONDUCTOR_FINANCIAL_SOURCE : id === 'rd' ? RESEARCH_PROJECT_SOURCE : SEMICONDUCTOR_SOURCE })),
    { key: 'policyTrade.power', settings: value.power, source: POWER_SOURCE },
    ...value.powerCases ? Object.entries(value.powerCases).map(([id, settings]) => ({ key: `policyTrade.powerMix.${id}`, settings, source: POWER_SOURCE })) : [],
    ...value.mix ? [{ key: 'policyTrade.powerMix.weights', settings: value.mix, source: POWER_SOURCE }] : []];
  return groups.flatMap(group => Object.entries(group.settings).filter(([, v]) => typeof v === 'number').map(([key, v]) => ({
    key: `${group.key}.${key}`, value: v as number,
    unit: key === 'lag' || key === 'lifetime' ? '年' : key === 'capexPerKw' ? '円/kW' : key.includes('YenPerKwh') ? '円/kWh' : key === 'annualSalesPerInvestment' ? '年あたり売上/投資額' : '比率',
    referenceYear: '事業別試算の入力条件（2026-09-15）', sourceName: group.key.startsWith('policyTrade.power') ? '電源別の公表諸元を参考にした条件' : '政策固有の事業条件',
    sourceUrl: key === 'capexImportShare' ? projectImportReference.sourceUrl : group.key === 'policyTrade.semiconductors' && IO_REFERENCE_KEYS.includes(key) ? industryReference.sourceUrl : key === 'firmShare' ? null : key === 'lag' && 'technology' in group.settings && group.settings.technology === 'solar' ? POWER_CONSTRUCTION_SOURCE : group.source, status: 'assumption' as const,
    uncertaintyNote: (key === 'capexImportShare' ? PROJECT_IMPORT_NOTE : '') + (group.key === 'policyTrade.rd' ? RESEARCH_PROJECT_NOTE : '') + (group.key === 'policyTrade.semiconductors' && IO_REFERENCE_KEYS.includes(key) ? `初期条件は${industryReference.referenceYear}年全国産業連関表の${industryReference.sectorName}部門を参照。輸出${INDUSTRY_TRADE_REFERENCE_PERCENT.exportShare}%、供給網輸入原価${INDUSTRY_TRADE_REFERENCE_PERCENT.operatingImportShare}%（比例配分推計）、国内置換${INDUSTRY_TRADE_REFERENCE_PERCENT.domesticReplacementShare}%は輸入浸透率を代用する仮定。新設工場の因果推計ではない。` : '') + (key === 'lag' && 'technology' in group.settings && group.settings.technology === 'solar' ? SOLAR_LAG_NOTE : '') + (key === 'firmShare' ? POWER_FIRM_NOTE : '') + ('technology' in group.settings && group.settings.technology === 'nuclear' && key === 'operatingImportYenPerKwh' ? '初期値0.95円/kWhは公表核燃料サイクル費1.9円/kWh×海外支払割合50%という仮定。輸入割合は未校正。' : '') + '資産投資の条件は本体のGDP・財政枠へ反映。原資料は経路・諸元の参考で、任意の入力値を実証するものではない。売上の純追加性、調達先、稼働遅れ、火力置換、確実供給は案件別の校正が必要。未設定値は出典表からも除外。',
  })));
}
