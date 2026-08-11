import { NextResponse } from 'next/server';
import {
  buildPolicyEvaluations,
  POLICY_CATEGORY_LABELS,
  RECOMMENDATION_ORDER,
  IMPROVEMENT_ACTION_ORDER,
  type PolicyEvaluation,
  type PolicyQualityInput,
} from '@/app/lib/policy-evaluation';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { readDataJson, tryReadDataJson } from '@/app/lib/api/data-file';

/**
 * Sankey 図に重ねるための、事業ごとの政策評価サマリ。
 *
 * `/quality` はクライアント側で品質スコア全件から政策評価を組み立てているが、
 * Sankey は公開メインページで初期表示の重さが直結するため、
 * サーバ側で算出して「必要な数値だけ」を短いキーで返す。
 * 5,794事業でも数百KB程度に収まり、gzip 後はさらに小さくなる。
 */
export interface PolicySummaryEntry {
  /** 総合点 */
  o: number | null;
  /** 成果設計 */
  d: number | null;
  /** 検証可能性 */
  e: number | null;
  /** 執行透明性 */
  t: number | null;
  /** 費用対内容 */
  x: number | null;
  /** 必要性 */
  n: number | null;
  /** 推奨判断（RECOMMENDATION_ORDER の番号。未判定は 0） */
  r: number;
  /** 改善アクション（IMPROVEMENT_ACTION_ORDER の番号。無しは 0） */
  a: number;
  /** 政策類型の id。未分類は省略 */
  c?: string;
}

/** `?pid=` 指定時の応答。1事業の完全な政策評価を返す */
export interface PolicyEvaluationResponse {
  year: number;
  /** 政策類型 id → 表示名 */
  categories: Record<string, string>;
  evaluation: PolicyEvaluation;
}

export interface PolicySummaryResponse {
  year: number;
  /** 番号 → ラベル の対応表。クライアントで文字列を復元するために同梱する */
  recommendations: Record<number, string>;
  actions: Record<number, string>;
  /** 政策類型 id → 表示名 */
  categories: Record<string, string>;
  /** pid → サマリ */
  items: Record<string, PolicySummaryEntry>;
}

const cache = new Map<string, PolicySummaryResponse>();

// Vercel の関数バンドルに public/data は同梱されない（data/server の .gz だけ）。
// パス解決は data-file.ts に一元化する（直に public/data を読むと本番で必ず落ちる）。
function loadQuality(year: string): PolicyQualityInput[] {
  return readDataJson<PolicyQualityInput[]>(
    `project-quality-scores-${year}.json`,
    `python3 scripts/score-project-quality-ai.py --year ${year} を実行してください。`,
  );
}

function invert(order: Record<string, number>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [label, index] of Object.entries(order)) out[index] = label;
  return out;
}

/**
 * 前年度の執行率 pid→rate。縮小判定で「単年度の不用」と「2年連続の構造的な計上過大」を
 * 区別するために要る。`/quality` はこれを `/api/execution-history` から取って
 * クライアント側で突き合わせているので、ここでも同じ導出をしないと
 * 同じ事業で Sankey と一覧の推奨判断が食い違う（Sankey 側だけ「縮小」が出なくなる）。
 */
function loadPriorExecutionRates(year: string): Record<string, number> {
  const rates: Record<string, number> = {};
  let prior: PolicyQualityInput[];
  try {
    prior = loadQuality(String(Number(year) - 1));
  } catch {
    return rates;   // 前年度データが無い年度は「判定不能」のままにする
  }
  for (const row of prior) {
    // 執行実績が無い事業（予備的経費・未着手）は「全額不用」ではなく判定対象外
    if (!(row.budgetAmount > 0 && row.execAmount > 0)) continue;
    rates[row.pid] = Math.round((row.execAmount / row.budgetAmount) * 1000) / 1000;
  }
  return rates;
}

/**
 * 全事業の政策評価。母集団のパーセンタイル・分位点から閾値を決めるため、
 * 1事業だけを切り出して計算することはできない（必ず全件を通す）。
 * 年度ごとに1回だけ組み立ててキャッシュし、サマリと pid 単体の両方で使い回す。
 */
const evalCache = new Map<string, Map<string, PolicyEvaluation>>();

function buildEvaluations(year: string): Map<string, PolicyEvaluation> {
  const cached = evalCache.get(year);
  if (cached) return cached;

  const rates = loadPriorExecutionRates(year);
  const rows = buildPolicyEvaluations(
    loadQuality(year).map((i) => ({ ...i, priorExecutionRate: rates[i.pid] ?? null })),
  );
  const index = new Map(rows.map((row) => [row.pid, row]));
  evalCache.set(year, index);
  return index;
}

function build(year: string): PolicySummaryResponse {
  const cached = cache.get(year);
  if (cached) return cached;

  const rows = [...buildEvaluations(year).values()];
  const items: Record<string, PolicySummaryEntry> = {};
  for (const row of rows) {
    items[row.pid] = {
      o: row.overallScore,
      d: row.designClarityScore,
      e: row.evidenceScore,
      t: row.executionTransparency,
      x: row.proportionalityScore,
      n: row.necessityScore,
      r: row.recommendation ? (RECOMMENDATION_ORDER[row.recommendation] ?? 0) : 0,
      a: row.improvementAction ? (IMPROVEMENT_ACTION_ORDER[row.improvementAction] ?? 0) : 0,
      ...(row.policyCategory ? { c: row.policyCategory } : {}),
    };
  }

  const result: PolicySummaryResponse = {
    year: Number(year),
    recommendations: invert(RECOMMENDATION_ORDER),
    actions: invert(IMPROVEMENT_ACTION_ORDER),
    categories: POLICY_CATEGORY_LABELS,
    items,
  };
  cache.set(year, result);
  return result;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    // pid 指定は「サイドパネル等から1事業だけ引きたい」用途。サマリの圧縮形では
    // 判定理由（recommendationReason・findings）まで返せないため、完全な
    // PolicyEvaluation をそのまま返す。母集団の計算はサーバ側で1回だけ行う。
    const pid = url.searchParams.get('pid');
    if (pid !== null) {
      const evaluation = buildEvaluations(year).get(pid);
      if (!evaluation) {
        return NextResponse.json({ error: `事業が見つかりません（pid=${pid}）` }, { status: 404 });
      }
      return NextResponse.json(
        {
          year: Number(year),
          categories: POLICY_CATEGORY_LABELS,
          evaluation,
        } satisfies PolicyEvaluationResponse,
        { headers: { 'Cache-Control': API_CACHE_CONTROL } },
      );
    }

    return NextResponse.json(build(year), {
      headers: { 'Cache-Control': API_CACHE_CONTROL },
    });
  } catch (e) {
    return serverErrorResponse('policy-summary', e);
  }
}
