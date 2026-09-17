import type { SourceValue } from '@/types/fiscal-space';
import projection from './data/population-projection.json';
import participation from './data/participation-by-age.json';
import ageing from './data/ageing-expenditure.json';

/** Official medium-variant population by five-year age group with 2024 participation rates
 * held fixed. The labour-force index is Σ population × rate relative to the base year.
 * Policy channels add births; they reach the labour force through the same age groups. */
export interface DemographicAssumptions {
  /** 'off' keeps the pre-2026-09-17 flat labour force and expenditure path for comparison. */
  mode: 'included' | 'off';
  /** Output elasticity of potential GDP to the labour-force index (labour share proxy). */
  labourElasticity: number;
  /** TFR change per +1 percentage point of GDP spent on families. A stated assumption, not a Japanese estimate. */
  fertilityPerGdpPoint: number;
  /** Relative TFR change per 1% rise in net labour income (0 disables the channel). */
  fertilityIncomeElasticity: number;
  /** Share of primary expenditure that follows the 65+ population (pension, medical, long-term care). */
  ageingShare: number;
  /** Share of primary expenditure that follows the 0–14 population (family benefits). */
  childBenefitShare: number;
}
export const DEMOGRAPHICS: DemographicAssumptions = {
  // 0.2: order of magnitude implied by Fenge & Scheubel (ECB WP 1734, 2014), contribution capacity vs marital
  // births in 1890s Germany (+1 Mark on ~20 → +0.4 per 1,000 on ~35). A conversion assumption, not a Japanese estimate.
  mode: 'included', labourElasticity: .55, fertilityPerGdpPoint: .1, fertilityIncomeElasticity: .2,
  // FY2023 pension + medical + long-term care 19.08% of GDP over primary expenditure 35.9% of GDP (2024, IMF).
  ageingShare: Math.round(ageing.ageingLinkedShare.pensionMedicalLtcPercentGdp / 35.9 * 1000) / 1000,
  childBenefitShare: Math.round(ageing.fy2023.socialExpenditureByPolicyAreaPercentGdp.family / 35.9 * 1000) / 1000,
};
/** Comparison switch: the flat labour force and expenditure path used before 2026-09-17. */
export const DEMOGRAPHICS_OFF: DemographicAssumptions = { ...DEMOGRAPHICS, mode: 'off' };
export const PROJECTION_YEARS = { first: projection.years[0], last: projection.years[projection.years.length - 1] };
const GROUPS = projection.ageGroups as string[];
const rateFor = (group: string): number => {
  const rates = participation.rates as Record<string, number>;
  const detail = participation.ratesDetail65plus as Record<string, number>;
  if (group in rates && group !== '65+') return rates[group];
  const start = Number(group.split(/[-+]/)[0]);
  if (start < 15) return 0;
  if (start < 70) return detail['65-69'];
  if (start < 75) return detail['70-74'];
  return detail['75+'];
};
const RATES = GROUPS.map(rateFor);
const groupIndex = (age: number) => Math.min(GROUPS.length - 1, Math.floor(age / 5));
const population = (calendarYear: number): number[] => {
  const year = Math.min(PROJECTION_YEARS.last, Math.max(PROJECTION_YEARS.first, calendarYear));
  return (projection.population as Record<string, number[]>)[String(year)];
};
const births = (calendarYear: number): number => {
  const table = projection.births as Record<string, number>;
  const years = Object.keys(table).map(Number);
  const year = Math.min(Math.max(...years), Math.max(Math.min(...years), calendarYear));
  return table[String(year)];
};
const tfr = (calendarYear: number): number => {
  const table = projection.tfr as Record<string, number>;
  const year = Math.min(PROJECTION_YEARS.last, Math.max(PROJECTION_YEARS.first, calendarYear));
  return table[String(year)];
};

export function validateDemographics(d: DemographicAssumptions): void {
  if (!['included', 'off'].includes(d.mode)) throw new RangeError('Invalid demographic mode');
  for (const [key, value] of Object.entries(d)) {
    if (key === 'mode') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError(`Invalid demographic assumption: ${key}`);
  }
  if (d.labourElasticity > 1 || d.ageingShare + d.childBenefitShare > 1 || d.fertilityPerGdpPoint > 1 || d.fertilityIncomeElasticity > 2) throw new RangeError('Demographic assumption out of range');
}

/** Extra births attributed to policy in a calendar year. Ratios are shares of that year's nominal GDP. */
export interface BirthDriver { calendarYear: number; familySpendingGdpShare: number; netIncomeChange: number }
export const extraBirths = (driver: BirthDriver, d: DemographicAssumptions): number => {
  const base = births(driver.calendarYear), current = tfr(driver.calendarYear);
  const deltaTfr = d.fertilityPerGdpPoint * driver.familySpendingGdpShare * 100 + d.fertilityIncomeElasticity * driver.netIncomeChange * current;
  return Math.max(-base, base * deltaTfr / current);
};

export interface DemographicPath {
  calendarYear: number;
  labourForceIndex: number; population65Index: number; childIndex: number; population15Index: number;
  births: number; extraBirths: number; cumulativeExtraBirths: number; beyondProjection: boolean;
  /** Medium-variant total fertility rate and the rate implied by policy births in the same year. */
  baselineTfr: number; tfr: number;
}
const sum = (values: number[], from: number, to = GROUPS.length) => values.slice(from, to).reduce((s, v) => s + v, 0);
const labourForce = (pop: number[]) => pop.reduce((s, n, i) => s + n * RATES[i], 0);

/** Indices relative to the base calendar year. Policy births accumulate from `drivers` (one per year, in order). */
export function demographicPath(baseYear: number, calendarYear: number, d: DemographicAssumptions, drivers: BirthDriver[] = []): DemographicPath {
  validateDemographics(d);
  const base = population(baseYear), current = population(calendarYear).slice();
  let extra = 0, cumulative = 0, extraThisYear = 0;
  for (const driver of drivers) {
    if (driver.calendarYear > calendarYear) continue;
    const added = extraBirths(driver, d);
    cumulative += added;
    if (driver.calendarYear === calendarYear) extraThisYear += added;
    const age = calendarYear - driver.calendarYear;
    current[groupIndex(age)] += added;
    extra += added;
  }
  void extra;
  const off = d.mode === 'off';
  return { calendarYear,
    labourForceIndex: off ? 1 : labourForce(current) / labourForce(base),
    population65Index: off ? 1 : sum(current, 13) / sum(base, 13),
    childIndex: off ? 1 : sum(current, 0, 3) / sum(base, 0, 3),
    population15Index: off ? 1 : sum(current, 3) / sum(base, 3),
    births: births(calendarYear) + extraThisYear, extraBirths: extraThisYear, cumulativeExtraBirths: cumulative,
    baselineTfr: tfr(calendarYear), tfr: tfr(calendarYear) * (births(calendarYear) + extraThisYear) / births(calendarYear),
    beyondProjection: calendarYear > PROJECTION_YEARS.last };
}

/** Expenditure multiplier on the common nominal trend: ageing-linked and child-linked shares follow their populations. */
export const expenditureDemographicFactor = (path: DemographicPath, d: DemographicAssumptions) =>
  d.mode === 'off' ? 1 : (1 - d.ageingShare - d.childBenefitShare) + d.ageingShare * path.population65Index + d.childBenefitShare * path.childIndex;

export const DEMOGRAPHIC_SOURCES = {
  projection: { name: projection.source as string, url: projection.sourcePage as string, retrievedOn: projection.retrievedOn as string },
  participation: { name: participation.source as string, url: participation.sourcePage as string, retrievedOn: participation.retrievedOn as string },
  ageing: { name: (ageing.sources as { name: string; url: string }[])[0].name, url: (ageing.sources as { name: string; url: string }[])[0].url, retrievedOn: ageing.retrievedOn as string },
};

export function demographicRecords(d: DemographicAssumptions, baseYear: number): SourceValue[] {
  const at = (year: number) => demographicPath(baseYear, year, { ...d, mode: 'included' });
  const rows: SourceValue[] = [
    { key: 'demographics.labourForceIndex2040', value: at(2040).labourForceIndex, unit: `指数（${baseYear}年 = 1）`, referenceYear: '2040年',
      sourceName: `${DEMOGRAPHIC_SOURCES.projection.name}×${DEMOGRAPHIC_SOURCES.participation.name}`, sourceUrl: DEMOGRAPHIC_SOURCES.projection.url, status: 'derived',
      uncertaintyNote: '年齢5歳階級別人口（出生中位・死亡中位）に2024年の年齢階級別労働力率を固定して掛けた指数。参加率の将来変化、外国人労働、労働時間は含まない。潜在GDPには労働弾力性を掛けて反映。' },
    { key: 'demographics.population65Index2040', value: at(2040).population65Index, unit: `指数（${baseYear}年 = 1）`, referenceYear: '2040年',
      sourceName: DEMOGRAPHIC_SOURCES.projection.name, sourceUrl: DEMOGRAPHIC_SOURCES.projection.url, status: 'derived',
      uncertaintyNote: '65歳以上人口の指数。年金・医療・介護に相当する歳出割合に掛ける。1人当たり給付の制度改定・医療技術は共通の実質成長率に含めた仮定。' },
    { key: 'demographics.ageingShare', value: d.ageingShare, unit: '比率（1 = 100%）', referenceYear: '2023年度／2024年',
      sourceName: DEMOGRAPHIC_SOURCES.ageing.name, sourceUrl: DEMOGRAPHIC_SOURCES.ageing.url, status: 'derived',
      uncertaintyNote: '年金＋医療＋介護の給付費（2023年度、GDP比19.08%）÷一般政府の基礎的歳出（2024年、GDP比35.9%）。年度と暦年、ILO基準と政府財政統計の範囲差を含む近似。' },
    { key: 'demographics.childBenefitShare', value: d.childBenefitShare, unit: '比率（1 = 100%）', referenceYear: '2023年度／2024年',
      sourceName: DEMOGRAPHIC_SOURCES.ageing.name, sourceUrl: DEMOGRAPHIC_SOURCES.ageing.url, status: 'derived',
      uncertaintyNote: 'OECD基準の家族関係社会支出（GDP比1.93%）÷基礎的歳出（GDP比35.9%）。0〜14歳人口の指数に連動させる。' },
    { key: 'demographics.labourElasticity', value: d.labourElasticity, unit: '無次元（弾力性）', referenceYear: 'シナリオ設定',
      sourceName: 'モデル仮定（労働分配率の代理）', sourceUrl: null, status: 'assumption',
      uncertaintyNote: '労働力人口指数1%の変化が潜在GDPを何%変えるか。労働分配率0.5〜0.6の範囲を参考にした仮定で、資本の調整や生産性の反応は含まない。' },
    { key: 'demographics.fertilityPerGdpPoint', value: d.fertilityPerGdpPoint, unit: '合計特殊出生率の変化／GDP比1ポイント', referenceYear: 'シナリオ設定',
      sourceName: 'モデル仮定（家族政策支出と出生率の国際比較研究の幅を参考）', sourceUrl: null, status: 'assumption',
      uncertaintyNote: '家族関係支出のGDP比が1ポイント増えたときの合計特殊出生率の変化。OECD諸国のパネル推計に幅があり、日本の因果推定値ではない。0で経路を無効化できる。追加出生は15年後以降に労働力へ入る。' },
    { key: 'demographics.fertilityIncomeElasticity', value: d.fertilityIncomeElasticity, unit: '無次元（弾力性）', referenceYear: 'シナリオ設定',
      sourceName: d.fertilityIncomeElasticity === 0 ? '未同定の効果は加算しない設定' : 'モデル仮定（Fenge & Scheubel 2014 の歴史データからの換算）', sourceUrl: d.fertilityIncomeElasticity === 0 ? null : 'https://www.ecb.europa.eu/pub/pdf/scpwps/ecbwp1734.pdf', status: 'assumption',
      uncertaintyNote: '社会保険料減税による本人の手取り1%増が合計特殊出生率を何%変えるか。初期値0.2は、ビスマルク年金導入期のドイツ州別データで被保険者1人当たり拠出能力1マルク増が婚姻出生率を千人当たり0.4上げた係数を弾力性に換算した桁の仮定で、現代日本の因果推定値ではない。同論文の第二の経路（年金の内部収益率）は別建てにしていない。賦課方式の内部収益率は賃金総額の成長率に等しく（同論文式12）、このモデルでは労働力人口指数と成長経路がそれを担うため、所得効果だけを係数に置く。0で経路を無効化できる。' },
  ];
  return rows;
}
