/**
 * 全事業の政策評価（PolicyEvaluation）の組み立てとキャッシュ。
 *
 * 母集団のパーセンタイル・分位点から閾値を決めるため、1事業だけを切り出して計算することは
 * できない（必ず全件を通す）。/api/policy-summary と /api/quality-sections が共用する。
 * 前年度の執行率は「単年度の不用」と「2年連続の構造的な計上過大」を区別するために突き合わせる
 * （/quality がクライアント側で /api/execution-history と突き合わせているのと同じ導出）。
 */

import { buildPolicyEvaluations, type PolicyEvaluation, type PolicyQualityInput } from '@/app/lib/policy-evaluation';
import { loadQualityScores } from './quality-scores-loader';
import { qualitySourceYear, type QualityYear } from './quality-year';

const evalCache = new Map<string, Map<string, PolicyEvaluation>>();

/** 前年度の執行率 pid→rate。前年度データが無い年度は空（判定不能のまま） */
function loadPriorExecutionRates(year: QualityYear): Record<string, number> {
  const rates: Record<string, number> = {};
  const prior = String(Number(qualitySourceYear(year)) - 1);
  if (prior !== '2024' && prior !== '2025') return rates;
  let rows: PolicyQualityInput[];
  try {
    rows = loadQualityScores(prior).items.map(i => ({ ...i, execAmount: i.execAmount ?? 0 }));
  } catch {
    return rates;
  }
  for (const row of rows) {
    // 執行実績が無い事業（予備的経費・未着手）は「全額不用」ではなく判定対象外
    if (!(row.budgetAmount > 0 && row.execAmount > 0)) continue;
    rates[row.pid] = Math.round((row.execAmount / row.budgetAmount) * 1000) / 1000;
  }
  return rates;
}

export function loadPolicyEvaluations(year: QualityYear): Map<string, PolicyEvaluation> {
  const cached = evalCache.get(year);
  if (cached) return cached;

  const rates = loadPriorExecutionRates(year);
  const rows = buildPolicyEvaluations(
    loadQualityScores(year).items.map(i => ({ ...i, execAmount: i.execAmount ?? 0, priorExecutionRate: rates[i.pid] ?? null }))
  );
  const index = new Map(rows.map(row => [row.pid, row]));
  evalCache.set(year, index);
  return index;
}
