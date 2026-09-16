import { priorBudgetHistory } from './prior-budget-history';
/**
 * 全事業の政策評価（PolicyEvaluation）の組み立てとキャッシュ。
 *
 * 母集団のパーセンタイル・分位点から閾値を決めるため、1事業だけを切り出して計算することは
 * できない（必ず全件を通す）。/api/policy-summary と /api/quality-sections が共用する。
 * 前年度の執行率は「単年度の不用」と「2年連続の構造的な計上過大」を区別するために突き合わせる
 * （/quality がクライアント側で /api/execution-history と突き合わせているのと同じ導出）。
 */

import { buildPolicyEvaluations, type PolicyEvaluation } from '@/app/lib/policy-evaluation';
import { loadQualityScores } from './quality-scores-loader';
import { type QualityYear } from './quality-year';

const evalCache = new Map<string, Map<string, PolicyEvaluation>>();

export function loadPolicyEvaluations(year: QualityYear): Map<string, PolicyEvaluation> {
  const cached = evalCache.get(year);
  if (cached) return cached;

  const { priorExecutionRates: rates, priorUnusedRatios } = priorBudgetHistory(year);
  const rows = buildPolicyEvaluations(
    loadQualityScores(year).items.map(i => ({ ...i, execAmount: i.execAmount ?? 0, priorExecutionRate: rates[i.pid] ?? null, priorUnusedRatio: priorUnusedRatios[i.pid] ?? null }))
  );
  const index = new Map(rows.map(row => [row.pid, row]));
  evalCache.set(year, index);
  return index;
}
