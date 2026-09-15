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

export const policyReliefLimit = (id: string, p: ModelParameters): number =>
  id === 'social-insurance' ? socialInsuranceLimit(p)
    : id === 'consumption-tax' ? consumptionTaxLimit(p) : Infinity;

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
