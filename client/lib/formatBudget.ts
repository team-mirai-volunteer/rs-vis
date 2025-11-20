/**
 * 金額フォーマットユーティリティ
 */

/**
 * 金額を日本語形式でフォーマット（兆・億・万円単位）
 * @param amount 金額（千円単位）
 * @returns フォーマットされた文字列
 * @example
 * formatBudget(1234567890) // "約1.2兆円"
 * formatBudget(123456) // "約1,234億円"
 * formatBudget(12345) // "約123億円"
 * formatBudget(1234) // "約12億円"
 */
export function formatBudget(amount: number): string {
  // 千円単位 → 円単位に変換
  const yen = amount * 1000;

  if (yen >= 1_000_000_000_000) {
    // 兆円単位
    const trillion = yen / 1_000_000_000_000;
    return `約${trillion.toFixed(1)}兆円`;
  } else if (yen >= 100_000_000) {
    // 億円単位
    const billion = yen / 100_000_000;
    return `約${Math.round(billion).toLocaleString()}億円`;
  } else if (yen >= 10_000) {
    // 万円単位
    const manYen = yen / 10_000;
    return `約${Math.round(manYen).toLocaleString()}万円`;
  } else {
    // 円単位
    return `約${Math.round(yen).toLocaleString()}円`;
  }
}

/**
 * 金額を短縮形式でフォーマット（Sankey図のツールチップ用）
 * @param amount 金額（千円単位）
 * @returns フォーマットされた文字列
 * @example
 * formatBudgetShort(1234567890) // "1.2兆円"
 * formatBudgetShort(123456) // "1,234億円"
 */
export function formatBudgetShort(amount: number): string {
  const yen = amount * 1000;

  if (yen >= 1_000_000_000_000) {
    const trillion = yen / 1_000_000_000_000;
    return `${trillion.toFixed(1)}兆円`;
  } else if (yen >= 100_000_000) {
    const billion = yen / 100_000_000;
    return `${Math.round(billion).toLocaleString()}億円`;
  } else if (yen >= 10_000) {
    const manYen = yen / 10_000;
    return `${Math.round(manYen).toLocaleString()}万円`;
  } else {
    return `${Math.round(yen).toLocaleString()}円`;
  }
}
