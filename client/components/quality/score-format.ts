/**
 * 品質スコア表示の共通フォーマッタ。
 * /quality ページと /sankey-svg のスコア詳細ダイアログで共用する（重複定義を置かないこと）。
 */

/**
 * スコア帯の意味色。green / yellow は Tailwind 標準色のまま（データのエンコーディング）。
 * 70-89 帯は旧来の青からデザインシステムのプライマリ（ティール）へ寄せ、
 * 50 未満は destructive トークン（#dc2626 = red-600 と同値）を使う。
 * /quality のヒストグラム（bg-primary/60 など）と帯の対応を揃えること。
 */
export function scoreColor(score: number | null): string {
  if (score === null) return 'text-mirai-text-muted';
  if (score >= 90) return 'text-green-600';
  if (score >= 70) return 'text-primary';
  if (score >= 50) return 'text-yellow-600';
  return 'text-destructive';
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
