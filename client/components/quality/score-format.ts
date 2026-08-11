/**
 * 品質スコア表示の共通フォーマッタ。
 * /quality ページと /sankey-svg のスコア詳細ダイアログで共用する（重複定義を置かないこと）。
 */

export function scoreColor(score: number | null): string {
  if (score === null) return 'text-gray-400';
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 70) return 'text-blue-600 dark:text-blue-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

export function formatAmount(yen: number | null): string {
  if (yen === null) return '-';
  if (yen >= 1e12) return `${(yen / 1e12).toFixed(2)}兆`;
  if (yen >= 1e8)  return `${(yen / 1e8).toFixed(1)}億`;
  if (yen >= 1e4)  return `${(yen / 1e4).toFixed(0)}万`;
  return yen.toLocaleString();
}

export function pct(v: number | null): string {
  if (v === null) return '-';
  return `${(v * 100).toFixed(1)}%`;
}
