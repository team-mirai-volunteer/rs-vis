/**
 * 事項一覧の表示整形ヘルパ。
 * 金額は円単位（予算書の印字は千円単位だが、生成時に1000倍して正規化している）。
 */

/**
 * 円単位の金額を「1.23兆円」「345.6億円」等に整形する。null は「—」。
 * 古い生成物にはフィールド自体が無いことがあるので undefined も受ける。
 */
export function formatYen(yen: number | null | undefined): string {
  if (yen === null || yen === undefined) return '—';
  const abs = Math.abs(yen);
  if (abs >= 1e12) return `${(yen / 1e12).toFixed(2)}兆円`;
  if (abs >= 1e8) return `${(yen / 1e8).toFixed(1)}億円`;
  if (abs >= 1e4) return `${Math.round(yen / 1e4).toLocaleString()}万円`;
  if (yen === 0) return '0円';
  return `${yen.toLocaleString()}円`;
}

/**
 * 増減率。
 * null = 比較欄が無い帳票（暫定予算）、'new' = 比較対象が0（新規計上）。
 */
export function changeRate(
  amount: number,
  previous: number | null | undefined
): number | null | 'new' {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return 'new';
  return (amount - previous) / previous;
}

/** 増減率の表示文字列 */
export function formatChangeRate(rate: number | null | 'new'): string {
  if (rate === null) return '—';
  if (rate === 'new') return '新規';
  const sign = rate > 0 ? '+' : '';
  return `${sign}${(rate * 100).toFixed(1)}%`;
}

/** 執行率（支出済 ÷ 歳出予算現額）。決算以外は null */
export function executionRate(item: {
  spent: number | null | undefined;
  currentAmount: number | null | undefined;
}): number | null {
  if (item.spent === null || item.spent === undefined || !item.currentAmount) return null;
  return item.spent / item.currentAmount;
}

/** 執行率の表示文字列 */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}
