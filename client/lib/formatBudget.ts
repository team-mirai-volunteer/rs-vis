/**
 * 金額フォーマットユーティリティ
 */

/**
 * 金額を日本語形式でフォーマット（兆・億・万円単位）
 * @param amount 金額（千円単位）
 * @returns フォーマットされた文字列
 * @example
 * formatBudget(1234567890) // "約1235兆円" (整数部4桁 → 小数なし)
 * formatBudget(123456789) // "約123.5兆円" (整数部3桁 → 小数第一位)
 * formatBudget(12345678) // "約12.35兆円" (整数部2桁 → 小数第二位)
 * formatBudget(1234567) // "約1.23兆円" (整数部1桁 → 小数第二位)
 */
export function formatBudget(amount: number): string {
  // 千円単位 → 円単位に変換
  const yen = amount * 1000;

  if (yen >= 1_000_000_000_000) {
    // 兆円単位
    const trillion = yen / 1_000_000_000_000;
    const integerDigits = Math.floor(trillion).toString().length;

    if (integerDigits >= 4) {
      return `約${Math.round(trillion).toLocaleString()}兆円`;
    } else if (integerDigits === 3) {
      return `約${trillion.toFixed(1)}兆円`;
    } else {
      return `約${trillion.toFixed(2)}兆円`;
    }
  } else if (yen >= 100_000_000) {
    // 億円単位
    const billion = yen / 100_000_000;
    const integerDigits = Math.floor(billion).toString().length;

    if (integerDigits >= 4) {
      return `約${Math.round(billion).toLocaleString()}億円`;
    } else if (integerDigits === 3) {
      return `約${billion.toFixed(1)}億円`;
    } else {
      return `約${billion.toFixed(2)}億円`;
    }
  } else if (yen >= 10_000) {
    // 万円単位
    const manYen = yen / 10_000;
    const integerDigits = Math.floor(manYen).toString().length;

    if (integerDigits >= 4) {
      return `約${Math.round(manYen).toLocaleString()}万円`;
    } else if (integerDigits === 3) {
      return `約${manYen.toFixed(1)}万円`;
    } else {
      return `約${manYen.toFixed(2)}万円`;
    }
  } else {
    // 円単位（小数なし）
    return `約${Math.round(yen).toLocaleString()}円`;
  }
}

/**
 * 金額を短縮形式でフォーマット（Sankey図のツールチップ用）
 * @param amount 金額（千円単位）
 * @returns フォーマットされた文字列
 * @example
 * formatBudgetShort(1234567890) // "1235兆円" (整数部4桁 → 小数なし)
 * formatBudgetShort(123456789) // "123.5兆円" (整数部3桁 → 小数第一位)
 * formatBudgetShort(12345678) // "12.35兆円" (整数部2桁 → 小数第二位)
 */
export function formatBudgetShort(amount: number): string {
  const yen = amount * 1000;

  if (yen >= 1_000_000_000_000) {
    const trillion = yen / 1_000_000_000_000;
    const integerDigits = Math.floor(trillion).toString().length;

    if (integerDigits >= 4) {
      return `${Math.round(trillion).toLocaleString()}兆円`;
    } else if (integerDigits === 3) {
      return `${trillion.toFixed(1)}兆円`;
    } else {
      return `${trillion.toFixed(2)}兆円`;
    }
  } else if (yen >= 100_000_000) {
    const billion = yen / 100_000_000;
    const integerDigits = Math.floor(billion).toString().length;

    if (integerDigits >= 4) {
      return `${Math.round(billion).toLocaleString()}億円`;
    } else if (integerDigits === 3) {
      return `${billion.toFixed(1)}億円`;
    } else {
      return `${billion.toFixed(2)}億円`;
    }
  } else if (yen >= 10_000) {
    const manYen = yen / 10_000;
    const integerDigits = Math.floor(manYen).toString().length;

    if (integerDigits >= 4) {
      return `${Math.round(manYen).toLocaleString()}万円`;
    } else if (integerDigits === 3) {
      return `${manYen.toFixed(1)}万円`;
    } else {
      return `${manYen.toFixed(2)}万円`;
    }
  } else {
    return `${Math.round(yen).toLocaleString()}円`;
  }
}
