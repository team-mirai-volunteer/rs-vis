import { NextResponse } from 'next/server';
import {
  POLICY_CATEGORY_LABELS,
  RECOMMENDATION_ORDER,
  IMPROVEMENT_ACTION_ORDER,
  type PolicyEvaluation,
} from '@/app/lib/policy-evaluation';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadPolicyEvaluations } from '@/app/lib/api/policy-evaluations-loader';
import { parseQualityYear, QUALITY_YEAR_ERROR, type QualityYear } from '@/app/lib/api/quality-year';

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


function invert(order: Record<string, number>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [label, index] of Object.entries(order)) out[index] = label;
  return out;
}


/**
 * 全事業の政策評価。母集団のパーセンタイル・分位点から閾値を決めるため、
 * 1事業だけを切り出して計算することはできない（必ず全件を通す）。
 * 年度ごとに1回だけ組み立ててキャッシュし、サマリと pid 単体の両方で使い回す。
 */
const buildEvaluations = (year: QualityYear) => loadPolicyEvaluations(year);

function build(year: QualityYear): PolicySummaryResponse {
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
    const year = parseQualityYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: QUALITY_YEAR_ERROR }, { status: 400 });
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
