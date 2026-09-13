/**
 * /quality 系 API の年度。
 *
 * 通常の年度（2024・2025）は RS シート年度で、採点結果 project-quality-scores-{年度}.json がある。
 * 2026 は「要求ベースの仮想年度」: シート 2025 の採点結果をそのまま使い、予算額だけを
 * 2-1 の翌年度要求額（2026 年度要求）に置き換えて見せる。執行額は無い。
 * 他の API（事業詳細・支出先など）は SUPPORTED_YEARS のまま 2026 を受けないので、
 * 呼び出し側は qualitySourceYear() でシート年度に戻してから叩く。
 */

import { SUPPORTED_YEARS, type SupportedYear } from './api-notes';

export const QUALITY_YEARS = ['2024', '2025', '2026'] as const;
export type QualityYear = (typeof QUALITY_YEARS)[number];

/** 要求ベースの仮想年度 → 採点結果を持つシート年度 */
const SOURCE_YEAR: Partial<Record<QualityYear, SupportedYear>> = { '2026': '2025' };

export function parseQualityYear(value: string | null): QualityYear | null {
  if (value == null || value === '') return '2024';
  return (QUALITY_YEARS as readonly string[]).includes(value) ? (value as QualityYear) : null;
}

/** 採点結果・事業詳細を読むシート年度 */
export function qualitySourceYear(year: QualityYear): SupportedYear {
  return SOURCE_YEAR[year] ?? (year as SupportedYear);
}

/** 予算額が翌年度要求額に置き換わっている年度か */
export function isRequestYear(year: QualityYear): boolean {
  return SOURCE_YEAR[year] !== undefined;
}

export const QUALITY_YEAR_ERROR = `対応していない年度です（${QUALITY_YEARS.join(' | ')}）`;

export { SUPPORTED_YEARS };
