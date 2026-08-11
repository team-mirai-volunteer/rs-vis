/**
 * 品質スコアバッジの色分け閾値（/quality のスコア解釈と揃える）。
 * メインSankey（/sankey-svg）と再委託ビュー（/subcontracts）の品質スコア表示で共用する。
 */
const SCORE_BADGE_GOOD_MIN = 90;
const SCORE_BADGE_WARN_MIN = 70;

export function getScoreBadgeColor(score: number): string {
  if (score >= SCORE_BADGE_GOOD_MIN) return '#2e7d32';
  if (score >= SCORE_BADGE_WARN_MIN) return '#f57c00';
  return '#c62828';
}
