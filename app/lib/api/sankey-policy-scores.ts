/**
 * SankeyQuery の評価系フィルタ（filter.scores・yearsRunning・outcomeIndicators）の判定に使う、
 * 事業 ID → 政策評価スコア・継続年数・成果指標の件数 の Map。
 * /api/sankey/matches と AI ツール（tool-executor-server）が共用する。年度ごとに 1 回だけ組み立ててキャッシュする。
 */
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { loadPolicyEvaluations } from '@/app/lib/api/policy-evaluations-loader';
import { loadQualityScores } from '@/app/lib/api/quality-scores-loader';
import { loadOutcomeCounts } from '@/app/lib/api/outcome-counts';
import type { SankeyPolicyScoreEntry, SankeyPolicyScores } from '@/app/lib/sankey-query';

const cache = new Map<SupportedYear, SankeyPolicyScores>();

export function loadSankeyPolicyScores(year: SupportedYear): SankeyPolicyScores {
  const hit = cache.get(year);
  if (hit) return hit;
  const yearsByPid = new Map(loadQualityScores(year).items.map(i => [i.pid, i.yearsRunning ?? null]));
  const outcomes = loadOutcomeCounts(year);
  const map = new Map<string, SankeyPolicyScoreEntry>();
  for (const row of loadPolicyEvaluations(year).values()) {
    map.set(row.pid, {
      overall: row.overallScore, design: row.designClarityScore, evidence: row.evidenceScore,
      transparency: row.executionTransparency, proportionality: row.proportionalityScore, necessity: row.necessityScore,
      years: yearsByPid.get(row.pid) ?? null,
    });
  }
  // 成果指標の件数は評価の無い事業にも付ける（「実績あり」で評価未了の事業を落とさないため）
  for (const [pid, c] of outcomes) {
    const entry = map.get(pid) ?? {};
    entry.outcome = c.outcome;
    entry.outcomeActual = c.outcomeActual;
    map.set(pid, entry);
  }
  cache.set(year, map);
  return map;
}
