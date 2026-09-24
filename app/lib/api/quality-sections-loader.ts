/**
 * 予算書の「項」ごとの政策評価（配下 RS事業の金額加重平均）。
 *
 * 入力:
 * - mof-rs-kou-moku-linkage-{予算年度}.json … 目 ↔ RS事業 の紐づけ（RS 2-2 の計上額 rsAmount）
 * - 政策評価（policy-evaluations-loader）… シート年度の全事業の 6 軸・推奨判断
 *
 * 項の識別子は統合ビューの項ノード ID（`sec-会計種別|所管|組織/特会|勘定|項コード|項名`）に
 * 揃え、一覧から統合ビューへその項を選択した状態で飛べるようにする。
 * 補正予算の紐づけは当初と二重計上になるため、重みは当初予算（要求年度は要求額）の行だけを使う。
 */

import { tryReadDataJson } from './data-file';
import { loadPolicyEvaluations } from './policy-evaluations-loader';
import { fiscalYear } from '@/app/lib/rs-fiscal-year';
import { qualitySourceYear, type QualityYear } from './quality-year';
import { aggregatePolicy, type WeightedProgram } from '@/app/lib/unified-budget/policy-aggregate';
import type { PolicySummaryEntry } from '@/app/api/policy-summary/route';
import type { MofRsKouMokuLinkageData } from '@/types/mof-rs-kou-moku-linkage';
import type { QualitySectionItem, QualitySectionsResponse } from '@/types/quality-sections';
import { RECOMMENDATION_ORDER, IMPROVEMENT_ACTION_ORDER } from '@/app/lib/policy-evaluation';

const cache = new Map<string, QualitySectionsResponse>();

const invert = (order: Record<string, number>): Record<number, string> =>
  Object.fromEntries(Object.entries(order).map(([label, index]) => [index, label]));

export function loadQualitySections(year: QualityYear): QualitySectionsResponse {
  const cached = cache.get(year);
  if (cached) return cached;

  const budgetYear = fiscalYear(year);
  const sourceYear = Number(qualitySourceYear(year));
  const linkage = tryReadDataJson<MofRsKouMokuLinkageData>(`mof-rs-kou-moku-linkage-${budgetYear}.json`);
  // 紐づけ表が無い、または採点結果と別のシート年度から作られている年度は集計しない
  // （2024 の紐づけ表はシート 2025 の執行年度行から作られており、シート 2024 の採点とは母集団が違う）
  if (!linkage || linkage.metadata.rsSheetYear !== sourceYear) {
    const empty: QualitySectionsResponse = {
      year,
      budgetYear,
      rsSheetYear: sourceYear,
      rsAmountKind: 'budget',
      unavailable: true,
      items: [],
      summary: { sectionCount: 0, evaluatedSectionCount: 0, programCount: 0 },
    };
    cache.set(year, empty);
    return empty;
  }

  const evaluations = loadPolicyEvaluations(year);
  const entries: Record<string, PolicySummaryEntry> = {};
  for (const row of evaluations.values()) {
    entries[row.pid] = {
      o: row.overallScore,
      d: row.designClarityScore,
      e: row.evidenceScore,
      t: row.executionTransparency,
      x: row.proportionalityScore,
      n: row.necessityScore,
      r: row.recommendation ? (RECOMMENDATION_ORDER[row.recommendation] ?? 0) : 0,
      a: row.improvementAction ? (IMPROVEMENT_ACTION_ORDER[row.improvementAction] ?? 0) : 0,
    };
  }
  const recommendationLabels = invert(RECOMMENDATION_ORDER);

  type Bucket = { meta: Omit<QualitySectionItem, keyof ReturnType<typeof aggregatePolicy> | 'rsAmount'>; weights: Map<number, number> };
  const buckets = new Map<string, Bucket>();
  const allPids = new Set<number>();
  for (const l of linkage.links) {
    if (l.mofBudgetType !== '当初予算' || l.rsAmount <= 0) continue;
    if (l.mofAccountType !== 'general' && l.mofAccountType !== 'special') continue;
    const id = `sec-${l.mofAccountType}|${l.mofMinistry}|${l.mofOrganization}|${l.mofSubAccount ?? ''}|${l.sectionCode}|${l.sectionName}`;
    let b = buckets.get(id);
    if (!b) {
      b = {
        meta: {
          id,
          accountType: l.mofAccountType,
          ministry: l.mofMinistry,
          organization: l.mofOrganization,
          subAccount: l.mofSubAccount ?? '',
          sectionCode: l.sectionCode,
          sectionName: l.sectionName,
        },
        weights: new Map(),
      };
      buckets.set(id, b);
    }
    b.weights.set(l.projectId, (b.weights.get(l.projectId) ?? 0) + l.rsAmount);
    allPids.add(l.projectId);
  }

  const items: QualitySectionItem[] = [];
  for (const b of buckets.values()) {
    const programs: WeightedProgram[] = [...b.weights].map(([pid, weight]) => ({ pid, weight }));
    const agg = aggregatePolicy(programs, entries, recommendationLabels);
    items.push({ ...b.meta, ...agg, rsAmount: programs.reduce((s, p) => s + p.weight, 0) });
  }
  items.sort((a, b) => b.rsAmount - a.rsAmount);

  const result: QualitySectionsResponse = {
    year,
    budgetYear,
    rsSheetYear: sourceYear,
    rsAmountKind: linkage.metadata.rsAmountKind === 'request' ? 'request' : 'budget',
    unavailable: false,
    items,
    summary: {
      sectionCount: items.length,
      evaluatedSectionCount: items.filter(i => i.evaluatedCount > 0).length,
      programCount: allPids.size,
    },
  };
  cache.set(year, result);
  return result;
}
