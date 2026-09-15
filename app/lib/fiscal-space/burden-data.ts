import type { SourceValue } from '@/types/fiscal-space';
import type { AgeClass } from '@/types/tax-burden';
import { consumptionTax } from '../tax-burden/consumption-tax';
import ageData from './age-burden-2024.json';
import ageWeights from './age-burden-weights-2024.json';
import incidenceData from './burden-incidence-2024.json';
import { corporateTaxOnWages } from '../tax-burden/incidence';
export const BURDEN_INCIDENCE = incidenceData;
export const CORPORATE_WAGE_SHARE = .25;
export const CORPORATE_SOURCE = 'https://www.oecd.org/en/data/datasets/global-revenue-statistics-database.html';

export const NATIONAL_BURDEN_SOURCE = 'https://www.mof.go.jp/policy/budget/topics/futanritsu/sy202603a.pdf';
export const AGE_BURDEN_SOURCE = ageData.metadata.sourceUrl;
// Use MOF's published GDP ratios, with the GDP and NI from the SAME fiscal-year
// table/vintage. Never divide historical receipts by the simulator's latest GDP.
// Component GDP ratios are approximate conversions of rounded NI ratios; the
// published total is retained independently, including its rounding difference.
export const NATIONAL_BURDEN = [
  { year: 2024, rate: .329, niRate: .467, taxNi: .282, socialNi: .185, nationalIncome: 452.0e12, gdp: 642.4e12, label: '実績' },
  { year: 2025, rate: .329, niRate: .461, taxNi: .283, socialNi: .178, nationalIncome: 477.6e12, gdp: 669.2e12, label: '実績見込み' },
  { year: 2026, rate: .327, niRate: .457, taxNi: .280, socialNi: .176, nationalIncome: 496.1e12, gdp: 691.9e12, label: '見通し' },
].map(r => ({ ...r, denominator: 'gdp' as const,
  tax: r.taxNi * r.nationalIncome / r.gdp, social: r.socialNi * r.nationalIncome / r.gdp }));

export const OECD_WORKING_BURDEN = [
  { year: 2024, edition: 2025, sourceUrl: 'https://www.oecd.org/en/publications/taxing-wages-2025_b3a95829-en/full-report/overview_715add19.html',
    cases: [{ id: 'single', label: '単身・子なし・平均賃金100%', japan: .326, oecd: .349 },
      { id: 'family', label: '片働き夫婦・子2人・平均賃金100%', japan: .257, oecd: .257 }] },
  { year: 2025, edition: 2026, sourceUrl: 'https://www.oecd.org/en/publications/taxing-wages-2026_3a5169ef-en/full-report/overview_d93131c3.html',
    cases: [{ id: 'single', label: '単身・子なし・平均賃金100%', japan: .331, oecd: .351 },
      { id: 'family', label: '片働き夫婦・子2人・平均賃金100%', japan: .284, oecd: .262 }] },
];

// Same 2024 survey and tax-inclusive basket as the revenue simulator.
// Adjusted household weights describe this survey population, not all people.
export const AGE_BURDEN = ageData.groups;
export const AGE_BURDEN_WEIGHTS = ageWeights.weights;
export const EMPLOYER_RATE = .16;
export const EMPLOYER_SOURCE = 'https://www.oecd.org/en/publications/2025/04/taxing-wages-2025_20d1a01d/full-report/japan_b78731c0.html';

export function extendedHouseholdBurden(row: AgeClass, employerRate = EMPLOYER_RATE, corporateShare = 0) {
  if (!Number.isFinite(employerRate) || employerRate < 0 || employerRate > .3) throw new RangeError('Invalid employer rate');
  if (!Number.isFinite(corporateShare) || corporateShare < 0 || corporateShare > 1) throw new RangeError('Invalid corporate share');
  const tax = Object.values(row.directTaxes).reduce((a, b) => a + b, 0);
  const social = Object.values(row.socialInsurance).reduce((a, b) => a + b, 0);
  const employer = row.salaryAnnual * employerRate;
  const vat = consumptionTax(row, .1, .08, 'gross-fixed').tax;
  const corporate = corporateTaxOnWages(incidenceData, row.salaryAnnual, corporateShare);
  // Allocated foregone wages belong on both sides of the pre-burden income ratio.
  const income = row.realIncomeAnnual + employer + corporate;
  return { tax, social, employer, vat, corporate, income, personalRate: (tax + social) / row.realIncomeAnnual,
    rate: (tax + social + employer + vat + corporate) / income };
}

export function workingHouseholdBurden(corporateShare = CORPORATE_WAGE_SHARE, employerRate = EMPLOYER_RATE) {
  const rows = AGE_BURDEN[0].classes.filter(row => row.headAge < 65).map(row => {
    const weight = AGE_BURDEN_WEIGHTS.find(w => w.label === row.label)?.weight;
    if (weight === undefined || weight <= 0) throw new Error(`Missing household weight: ${row.label}`);
    return { weight, ...extendedHouseholdBurden(row, employerRate, corporateShare) };
  });
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const income = rows.reduce((sum, row) => sum + row.weight * row.income, 0) / totalWeight;
  const burden = rows.reduce((sum, row) => sum + row.weight * (row.tax + row.social + row.employer + row.vat + row.corporate), 0) / totalWeight;
  return { average: burden / income, income, burden, totalWeight,
    min: Math.min(...rows.map(row => row.rate)), max: Math.max(...rows.map(row => row.rate)) };
}

export function burdenRecords(includeOutlook: boolean, corporateShare = CORPORATE_WAGE_SHARE): SourceValue[] {
  const benchmark = OECD_WORKING_BURDEN[includeOutlook ? 1 : 0];
  return [
    { key: 'burden.household.average', value: workingHouseholdBurden(corporateShare).average, unit: '比率（対事業主負担・法人税帰着加算後所得）',
      referenceYear: '2024年・世帯主65歳未満の二人以上勤労者世帯', sourceName: '家計調査 第3-2表・抽出率調整済み世帯数分布で集計',
      sourceUrl: AGE_BURDEN_SOURCE, status: 'estimated', uncertaintyNote: '平均＝Σ（世帯分布×年齢階級の負担額）÷Σ（世帯分布×所得）。割合の単純平均ではない。本人税・保険料、事業主負担16%、消費税推計、設定した法人税の賃金帰着を含む。分母は実収入＋事業主負担＋法人税帰着。単身・自営業を含む15〜64歳個人の全国平均ではなく、GDP比・NI比でもない。' },
    ...AGE_BURDEN_WEIGHTS.map((row, i) => ({ key: `burden.weight.${i}`, value: row.weight, unit: '全対象世帯10,000に対する分布',
      referenceYear: `2024年・勤労者世帯・世帯主${row.label}`, sourceName: '家計調査 第3-2表・世帯数分布(抽出率調整)',
      sourceUrl: AGE_BURDEN_SOURCE, status: 'verified' as const, uncertaintyNote: '生の集計世帯数ではなく抽出率調整後の分布。65歳未満の7階級を集計。公表値の丸めがあるため対象階級の合計で正規化。' })),
    ...benchmark.cases.flatMap(row => (['japan', 'oecd'] as const).map(country => ({
      key: `burden.oecd.${row.id}.${country}`, value: row[country], unit: '比率（対労働費用・現金給付控除後）',
      referenceYear: `${benchmark.year}年・${row.label}`, sourceName: `OECD Taxing Wages ${benchmark.edition}・${country === 'japan' ? '日本' : 'OECD公表平均'}`,
      sourceUrl: benchmark.sourceUrl, status: 'verified' as const,
      uncertaintyNote: '標準世帯の所得税＋本人・事業主社会保険料−現金給付を労働費用で割る税のくさび。消費税・法人税を含まない。実際の生産年齢人口の平均や家計調査の平均ではない。各年の版を使用し、後年の遡及改定を混ぜない。',
    }))),
    { key: 'burden.corporateShare', value: corporateShare, unit: '比率（法人課税のうち賃金へ配賦）', referenceYear: '感度仮定',
      sourceName: '利用者の帰着仮定', sourceUrl: null, status: 'assumption', low: 0, high: 1,
      uncertaintyNote: '初期値25%は比較用の仮定で日本の実証値ではない。国・地方の法人課税総額×帰着割合を日本全体の賃金で割り、各世帯給与へ配賦。残りの株主・価格等への帰着は未配賦。' },
    ...(['corporateTaxTotal', 'wagesAndSalaries'] as const).map(key => ({ key: `burden.${key}`, value: incidenceData[key], unit: '円', referenceYear: '2024暦年',
      sourceName: key === 'corporateTaxTotal' ? 'OECD Revenue Statistics・日本・区分1200' : 'OECD 国民経済計算・日本・D11',
      sourceUrl: key === 'corporateTaxTotal' ? CORPORATE_SOURCE : 'https://www.oecd.org/en/data/datasets/annual-national-accounts.html',
      status: 'verified' as const, uncertaintyNote: '歳入可視化と同じ2026-09-14取得の公表総額。法人課税は国・地方税を含む。賃金は全年齢を含む。' })),
    ...NATIONAL_BURDEN.filter(r => includeOutlook || r.year === 2024).flatMap(r => [{
      key: `burden.national.${r.year}`, value: r.rate, unit: '比率（対GDP比）',
      referenceYear: `${r.year}年度（${r.label}）`, publishedAt: '2026-03-05',
      sourceName: '財務省 国民負担率の推移', sourceUrl: NATIONAL_BURDEN_SOURCE,
      status: r.year === 2024 ? 'verified' as const : 'estimated' as const,
      uncertaintyNote: '租税＋社会保障負担 / 同年度の名目GDP。財務省の対GDP比公表値を採用。消費税・企業負担を含み、財政赤字を含まない。年度・集計範囲が異なるOECD暦年系列や家計所得比とは直接比較しない。2026-09-15確認。',
    }, {
      key: `burden.national.${r.year}.ni`, value: r.niRate, unit: '比率（対国民所得NI比・参考）',
      referenceYear: `${r.year}年度（${r.label}）`, publishedAt: '2026-03-05',
      sourceName: '財務省 国民負担率の推移', sourceUrl: NATIONAL_BURDEN_SOURCE,
      status: r.year === 2024 ? 'verified' as const : 'estimated' as const,
      uncertaintyNote: '租税＋社会保障負担 / 同年度の国民所得NI（要素費用表示）。財務省の公表総率をそのまま採用。GDP比と同じ負担を異なる分母で表す。NIは固定資本減耗と生産・輸入品に課される税（補助金控除後）をGNIから差し引いた額で、家計の手取りではない。公表値の丸めにより換算値・内訳合計とは差が生じる。',
    }, ...(['tax', 'social'] as const).map(key => ({
      key: `burden.national.${r.year}.${key}`, value: r[key], unit: '比率（対GDP比・概算）',
      referenceYear: `${r.year}年度（${r.label}）`, publishedAt: '2026-03-05',
      sourceName: '財務省 同年度の国民所得・GDPから内訳を換算', sourceUrl: NATIONAL_BURDEN_SOURCE,
      status: 'derived' as const,
      uncertaintyNote: `公表された対国民所得比×同表の国民所得${r.nationalIncome / 1e12}兆円÷GDP${r.gdp / 1e12}兆円。元の比率・金額の丸めを含む概算のため、内訳の合計は公表総率と一致しない場合がある。${r.label}の値であり、最新四半期GDPを混ぜない。`,
    }))]),
    ...AGE_BURDEN.flatMap((group, g) => group.classes.map((row, i) => ({
      key: `burden.household.${g}.${i}`, value: extendedHouseholdBurden(row, EMPLOYER_RATE, corporateShare).rate, unit: '比率（対事業主負担・法人税帰着加算後所得）',
      referenceYear: `2024年・${group.population}・世帯主${row.label}`, sourceName: '家計調査 第3-2表＋事業主負担・消費税の仮定',
      sourceUrl: AGE_BURDEN_SOURCE, status: 'estimated' as const,
      uncertaintyNote: `分子＝本人直接税・保険料＋勤め先収入×16%＋消費税推計＋法人課税の賃金帰着配賦。帰着割合は${corporateShare * 100}%の仮定。分母＝実収入＋事業主負担＋法人税帰着配賦額。年齢・加入制度・標準報酬上限を再現しない。消費税は按分・完全転嫁を仮定。二人以上の世帯のみ。国民負担率の年齢別内訳や15〜64歳個人の全国平均ではない。`,
    }))),
    { key: 'burden.employerRate', value: EMPLOYER_RATE, unit: '比率（対勤め先収入）', referenceYear: '2024年制度を参考にした換算仮定',
      sourceName: 'OECD Taxing Wages 2025・日本', sourceUrl: EMPLOYER_SOURCE, status: 'assumption',
      low: .14, high: .18, uncertaintyNote: '事業主の年金9.15%、健康約5%、雇用・労災・拠出金等を参考に16%へ丸めた仮定。14〜18%は信頼区間ではなく感度比較。負担の労働者への経済的帰着の実証値ではない。' },
  ];
}
