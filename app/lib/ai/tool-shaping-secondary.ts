/**
 * 補助ビュー向けツール（概算要求の検索・租税特別措置の検索・家計の税負担の試算）の応答整形。
 * サーバ実装（tool-executor-server.ts）とクライアント実装（client-tool-executor.ts）が同じ形を返すための Pure 層。
 * fs・fetch・React は import しない。
 */
import type { BudgetRequestRecord, RequestAmount } from '@/types/budget-requests';
import type { BurdenResult, ConsumptionDataset, TaxParameters } from '@/types/tax-burden';
import type { Assessment } from '@/app/lib/tax-expenditures/assessments';
import { axes } from '@/app/lib/tax-expenditures/assessments';
import { HOUSEHOLDS, initialTaxState } from '@/app/lib/tax-burden/households';
import { simulate, type SimulateState } from '@/app/lib/tax-burden/simulate';
import { encodeTaxState } from '@/app/lib/tax-burden/reform-url';
import { findNavTarget, navTargetHref, taxBurdenSearch, type TaxExpenditureYear } from '@/app/lib/ai/nav-targets';

export const BUDGET_REQUEST_SEARCH_LIMIT = 10;
export const TAX_EXPENDITURE_SEARCH_LIMIT = 10;

// ── 概算要求 ──
const amountYen = (a: RequestAmount) => a.valueYen;
const amountNote = (a: RequestAmount) => (a.valueYen === null ? a.raw || a.status : null);

/** 概算要求の検索結果（records は既に条件で絞ったもの。要求額の大きい順に 10 件だけ返す） */
export function shapeBudgetRequestSearch(records: readonly BudgetRequestRecord[], total: number, requestedFY: number, q: string, ministry: string) {
  const target = findNavTarget('budget-requests')!;
  return {
    requestedFY, q, ministry, count: total,
    note: `要求額の大きい順。金額は円。request=要求額、demand=要望額、previousYear=前年度額。財務省の概算要求明細表は 目 単位なので、1 行が複数の RS 事業をまとめることがある（rsProjectIds）。事業 1 件の要求額は get_budget_request で確かめる`,
    records: [...records].sort((a, b) => (b.amounts.request.valueYen ?? -1) - (a.amounts.request.valueYen ?? -1)).slice(0, BUDGET_REQUEST_SEARCH_LIMIT).map(r => ({
      ministry: r.ministry, department: r.department, account: r.account, projectName: r.projectName,
      requestYen: amountYen(r.amounts.request), requestNote: amountNote(r.amounts.request),
      demandYen: amountYen(r.amounts.demand), previousYearYen: amountYen(r.previousYear),
      rsProjectIds: r.rsLink.projectIds, rsLinkStatus: r.rsLink.status, sourceUrl: r.provenance.url,
    })),
    url: navTargetHref(target, { q, ministry }).href,
  };
}

// ── 租税特別措置 ──
/** data.json の 1 制度（表区分）。ツールが使う列だけの構造型 */
export interface TaxExpenditureMeasure {
  id: string; article: string; name: string; overview: string; deadline: string | null; rsProjectId: string | number | null; aliases?: string;
  rows: { entity: string; years: Record<string, (number | null)[]> }[];
}
const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '');

export function searchTaxExpenditures(measures: readonly TaxExpenditureMeasure[], assessments: Record<string, Assessment>, q: string, year: TaxExpenditureYear) {
  const needle = normalize(q);
  const hits = measures.filter(m => !needle || normalize(`${m.name}${m.article}${m.overview}${m.aliases ?? ''}`).includes(needle));
  const sum = (m: TaxExpenditureMeasure, col: number) => {
    const values = m.rows.filter(r => r.entity === '単体法人').map(r => r.years[year]?.[col] ?? null);
    return values.every(v => v === null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0);
  };
  const target = findNavTarget('tax-expenditures')!;
  return {
    q, year, count: hits.length,
    note: '法人税の租税特別措置の適用実態（財務省「租税特別措置の適用実態調査の結果に関する報告書」）。amountThousandYen は千円単位の適用額（単体法人の合計）。AI 評価は公開資料に基づく試行で、政府の公式評価ではない',
    measures: hits.slice(0, TAX_EXPENDITURE_SEARCH_LIMIT).map(m => {
      const a = assessments[m.id];
      return {
        id: m.id, name: m.name, article: `租税特別措置法 ${m.article}`, deadline: m.deadline,
        cases: sum(m, 0), corporations: sum(m, 1), amountThousandYen: sum(m, 2),
        rsProjectId: m.rsProjectId === null ? null : String(m.rsProjectId),
        overview: m.overview.replace(/\s+/g, ' ').slice(0, 200),
        assessment: a ? { scores: Object.fromEntries(axes.map((axis, i) => [axis, a.scores[i]?.score ?? null])), action: a.action } : null,
      };
    }),
    url: navTargetHref(target, { q, year }).href,
  };
}

// ── 国民負担（家計の税と保険料） ──
export interface TaxBurdenInput { income: number; household: SimulateState['household']; age: number; share: number; includeConsumption: boolean }

/** estimate_tax_burden の引数を検証する */
export function parseTaxBurdenInput(args: Record<string, unknown>): { input: TaxBurdenInput } | { error: string } {
  const base = initialTaxState();
  const income = typeof args.income === 'number' ? Math.round(args.income) : typeof args.income === 'string' && /^\d+$/.test(args.income.trim()) ? Number(args.income) : NaN;
  if (!Number.isFinite(income) || income < 0 || income > 20_000_000) return { error: 'income（年収・円）は 0〜20,000,000 の整数で指定してください' };
  const household = args.household === undefined ? base.household : args.household;
  if (typeof household !== 'string' || !HOUSEHOLDS.some(h => h.id === household)) return { error: `household は ${HOUSEHOLDS.map(h => `${h.id}（${h.label}）`).join(' / ')} のいずれか` };
  const age = args.age === undefined ? base.age : typeof args.age === 'number' ? Math.round(args.age) : NaN;
  if (!Number.isInteger(age) || age < 20 || age > 64) return { error: 'age は 20〜64 の整数で指定してください' };
  const share = args.share === undefined ? base.share : typeof args.share === 'number' ? Math.round(args.share) : NaN;
  if (!Number.isInteger(share) || share < 1 || share > 99) return { error: 'share（共働きの第1就労者の収入割合 %）は 1〜99 の整数' };
  const includeConsumption = args.includeConsumption === true;
  return { input: { income, household: household as SimulateState['household'], age, share, includeConsumption } };
}

/** 2025 年度制度で家計の税・保険料を試算し、ページの URL と一緒に返す */
export function estimateTaxBurdenWith(input: TaxBurdenInput, params: TaxParameters, consumption: ConsumptionDataset | null) {
  const state = { ...initialTaxState(), ...input };
  let result: BurdenResult;
  try { result = simulate(state, params, undefined, consumption, null); }
  catch (e) { return { error: e instanceof Error ? e.message : '試算できませんでした' }; }
  const household = HOUSEHOLDS.find(h => h.id === input.household)!;
  const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
  return {
    input: { ...input, householdLabel: household.label, fy: state.fy },
    note: '2025年度の税制・保険料率による現行法のモデル計算（給与所得のみ、協会けんぽ相当の料率、賞与なし等の仮定）。実際の課税・保険料とは異なる。金額は年額・円。netBurden = 税＋保険料 − 給付（児童手当等）',
    yen: {
      incomeTax: result.incomeTax, residentTax: result.residentTax, pension: result.pension, health: result.health, care: result.care, employment: result.employment,
      childBenefit: result.childBenefit, singleParentBenefit: result.singleParentBenefit,
      grossBurden: result.grossBurden, benefits: result.benefits, netBurden: result.netBurden,
      consumptionTax: input.includeConsumption ? result.consumptionTax : null,
    },
    netRatePercent: pct(result.netRate),
    netRateWithConsumptionPercent: input.includeConsumption ? pct(result.netRateWithConsumption) : null,
    outOfScope: result.outOfScope, scopeReasons: result.scopeReasons,
    url: `/tax-burden?${encodeTaxState(state)}`,
  };
}

export { taxBurdenSearch };
