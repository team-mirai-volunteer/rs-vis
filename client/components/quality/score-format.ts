/**
 * 品質スコア表示の共通フォーマッタ。
 * /quality ページと /sankey-svg のスコア詳細ダイアログで共用する（重複定義を置かないこと）。
 */

/**
 * スコア帯の定義（閾値と意味色）。一覧の数値色（scoreColor）と /quality のヒストグラムが
 * どちらもここを参照するため、閾値や色を変えるときはこの配列だけを直す。
 * 90 以上は status-good、70-89 はデザインシステムのプライマリ（ティール）、
 * 50-69 は status-warn（白地で 4.5:1 以上）、50 未満は destructive / status-bad。
 * 上から順に評価し、最初に `score >= min` を満たした帯を使う。
 */
export const SCORE_BANDS = [
  { min: 90, text: 'text-status-good-fg', badge: 'bg-status-good-bg text-status-good-fg', bar: 'bg-status-good-bar' },
  { min: 70, text: 'text-primary', badge: 'bg-primary/10 text-primary-accent', bar: 'bg-primary/60' },
  { min: 50, text: 'text-status-warn', badge: 'bg-status-warn-bg text-status-warn-fg', bar: 'bg-status-warn-bar' },
  { min: -Infinity, text: 'text-destructive', badge: 'bg-status-bad-bg text-status-bad-fg', bar: 'bg-status-bad-bar' },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number];

export function scoreBand(score: number): ScoreBand {
  return SCORE_BANDS.find(band => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function scoreColor(score: number | null): string {
  if (score === null) return 'text-mirai-text-muted';
  return scoreBand(score).text;
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
