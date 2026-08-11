/**
 * 会計区分バッジ（一般/特別/一般特別）の表示スタイル。
 * メインSankey（/sankey-svg）と再委託ビュー（/subcontracts）の予算・執行表示で共用する。
 * 引数は 'general' | 'special' | 'both'（未対応値・空は null）。
 */
/**
 * 会計区分の文字列（'一般会計'/'一般'/'特別会計'/'特別' 等）を badge キーへ分類する共通関数。
 * メインSankeyの予算表示・再委託ビューのツールチップ/予算アコーディオンで共用し、分類ルールの二重化を防ぐ。
 */
export function classifyAccountCategory(value?: string | null): 'general' | 'special' | null {
  if (!value) return null;
  if (value.includes('一般')) return 'general';
  if (value.includes('特別')) return 'special';
  return null;
}

export function getAccountBadgeStyle(category?: string | null): { label: string; background: string } | null {
  if (!category) return null;
  const generalColor = '#e45f6f';
  const specialColor = '#5f8ee8';
  if (category === 'general') return { label: '一般', background: generalColor };
  if (category === 'special') return { label: '特別', background: specialColor };
  if (category === 'both') {
    return {
      label: '一般特別',
      background: `linear-gradient(to right, ${generalColor} 0 50%, ${specialColor} 50% 100%)`,
    };
  }
  return null;
}
