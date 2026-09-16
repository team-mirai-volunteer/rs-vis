import type { ModelParameters, SourceValue } from '@/types/fiscal-space';
import { consumptionTaxLimit } from './calibration';

/** ILO financing, FY2024 actual; Table 6, published 2026-07-29. Yen. */
export const SOCIAL_INSURANCE_REVENUE = {
  insured: 436_765e8, employer: 393_661e8, total: 830_426e8,
  year: '2024年度', publishedAt: '2026-07-29',
  sourceUrl: 'https://www.ipss.go.jp/ss-cost/j/fsss-R06/1/R06-gaiyou.pdf',
};

/** Hold the observed bases fixed across datasets and years. This is a domain
 * guard, not a forecast of future contributions or an insurance-system model. */
export function socialInsuranceLimit(p: ModelParameters): number {
  const share = p.employeeReliefShare;
  if (!Number.isFinite(share) || share < 0 || share > 1) throw new RangeError('Invalid insurance relief split');
  return Math.min(
    share > 0 ? SOCIAL_INSURANCE_REVENUE.insured / share : Infinity,
    share < 1 ? SOCIAL_INSURANCE_REVENUE.employer / (1 - share) : Infinity,
    SOCIAL_INSURANCE_REVENUE.total,
  );
}

/** FY2024 receipts, held fixed in both data modes and throughout the horizon. */
export const PERSONAL_TAX_REVENUE = {
  'income-tax': {
    amount: 212_086e8, label: '所得税（国の一般会計）',
    sourceUrl: 'https://www.mof.go.jp/tax_policy/reference/fy2024k_budget_and_settlement.pdf',
    sourceName: '財務省 令和6年度一般会計税収の予算額と決算額', publishedAt: '2025-07-31',
    scope: '源泉所得税と申告所得税の計。復興特別所得税は対象外。',
  },
  'resident-tax': {
    amount: 4_452_998_483e3 + 8_187_266e6, label: '個人住民税の所得割（都道府県・市町村）',
    sourceUrl: 'https://www.e-stat.go.jp/stat-search/files?stat_infid=000040374263',
    sourceName: '総務省 令和6年度地方財政状況調査・道府県税の徴収実績、令和8年版地方財政白書 第13表その4',
    municipalSourceUrl: 'https://www.soumu.go.jp/main_content/001063596.pdf#page=38',
    publishedAt: '2026-03-27',
    scope: '所得割の収入済額の合計。均等割・法人住民税・利子割・配当割・株式等譲渡所得割・森林環境税は対象外。',
  },
} as const;

export function personalTaxRevenue(id: string) {
  return Object.hasOwn(PERSONAL_TAX_REVENUE, id)
    ? PERSONAL_TAX_REVENUE[id as keyof typeof PERSONAL_TAX_REVENUE] : undefined;
}

export const policyReliefLimit = (id: string, p: ModelParameters): number =>
  id === 'social-insurance' ? socialInsuranceLimit(p)
    : id === 'consumption-tax' ? consumptionTaxLimit(p) : personalTaxRevenue(id)?.amount ?? Infinity;

export function personalTaxRevenueRecords(): SourceValue[] {
  return Object.entries(PERSONAL_TAX_REVENUE).map(([id, source]) => ({
    key: `personalTaxRevenue.${id}`, value: source.amount, unit: '円', referenceYear: '2024年度',
    sourceName: source.sourceName, sourceUrl: source.sourceUrl, publishedAt: source.publishedAt,
    status: id === 'income-tax' ? 'verified' : 'derived',
    uncertaintyNote: `${source.scope} 両データモード・全評価年で実績額を固定し、将来の増収で限度を拡張しない。税額を超える還付は含まず、現金給付として別に入力する。`,
  }));
}

export function insuranceRevenueRecords(p: ModelParameters): SourceValue[] {
  const source = { unit: '円', referenceYear: SOCIAL_INSURANCE_REVENUE.year,
    sourceName: '社人研 令和6年度社会保障費用統計 表6（ILO基準）',
    sourceUrl: SOCIAL_INSURANCE_REVENUE.sourceUrl, publishedAt: SOCIAL_INSURANCE_REVENUE.publishedAt };
  return [
    ...(['insured', 'employer', 'total'] as const).map(key => ({ ...source,
      key: `insuranceRevenue.${key}`, value: SOCIAL_INSURANCE_REVENUE[key], status: 'verified' as const,
      uncertaintyNote: '本人（被保険者）・事業主の社会保険料。公費負担・資産収入を含まない。一般政府の税・社会負担合計とは集計基準が異なるため、別の入力限度の参照値として使用。',
    })),
    { ...source, key: 'insuranceRevenue.reliefLimit', value: socialInsuranceLimit(p), status: 'derived',
      uncertaintyNote: '本人・事業主への軽減配分を維持し、どちらの拠出額も超えない総額。両データモード・全評価年に2024年度実績を固定する仮定。制度別保険料・将来の保険料基盤は未推計。' },
  ];
}
