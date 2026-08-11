/**
 * AIチャットツールのクライアント実装（ChatToolExecutor）。BYOKモード用。
 *
 * - graph 由来ツール（run_sankey_query / compare_years / 府省庁一覧）は、ページが
 *   ロード済みの graph（または /data からの fetch）を使い**ブラウザ内でローカル実行**する
 *   （/api/sankey/query は本番非公開のため使わない。設計 20260718_1542 の4節）
 * - その他のツールは自サイトの**公開 API** を fetch し、応答をサーバ実装
 *   （tool-executor-server.ts が正典）と同じ payload 形に整形する。
 *   このとき LLM が組み立てた検索キーワード等の最小限のクエリはサーバへ届く
 *   （会話全文・キーは届かない）— UI・byok-chat.ts のプライバシー文言と整合させること。
 *   検索のローカル実行化は対象データが大きく（quality-scores 7MB・recipient-index 31MB 等）
 *   BYOK設計（公開API利用）の採用理由と衝突するため行わない（設計 20260718_1542 2節）
 * - fetch 失敗・404 は { error } payload に変換して LLM に正直に伝える（ループは壊さない）
 */
import type { GraphData } from '@/types/sankey-svg';
import type { SubcontractGraph } from '@/types/subcontract';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import type { QualityScoreProjection } from '@/app/lib/api/quality-scores-loader';
import type { ChatToolExecutor } from '@/app/lib/ai/chat-core';
import {
  SEARCH_LIMIT,
  DETAIL_TOP_LIMIT,
  clampText,
  clampPayload,
  validateQualityScorePids,
  validateHighlightMetric,
  ministryNamesFromGraph,
  executeQueryWithGraph,
  executeCompareYearsWithGraph,
  shapeSubcontractChain,
  shapeHighlights,
} from '@/app/lib/ai/tool-shaping';
import type { HighlightsResult } from '@/app/lib/highlights';

export type ClientGraphSource = (year: SupportedYear) => Promise<GraphData>;

/** 応答 JSON から links フィールドを再帰的に除去する（サーバ実装の payload に links は無い） */
function stripLinks<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripLinks) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'links') continue;
      out[k] = stripLinks(v);
    }
    return out as T;
  }
  return value;
}

/** 公開 API を叩いて JSON を返す。エラー時は { error } を throw せず返すための共通処理 */
async function fetchApi(path: string): Promise<{ status: number; json: unknown } | { fetchError: string }> {
  try {
    const res = await fetch(path, { signal: AbortSignal.timeout(30_000) });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { fetchError: 'データAPIへの接続に失敗しました。時間をおいて再度お試しください' };
  }
}

/** fetch 失敗・非200 を server 実装風の { error } payload に変換する共通ヘルパ */
function apiError(result: { status: number; json: unknown } | { fetchError: string }, notFoundPayload?: unknown): unknown {
  if ('fetchError' in result) return { error: result.fetchError };
  if (result.status === 404 && notFoundPayload) return notFoundPayload;
  const detail = (result.json as { error?: string } | null)?.error;
  return { error: detail ?? `データAPIがエラーを返しました（HTTP ${result.status}）` };
}

/**
 * クライアント版 ToolExecutor を生成する。
 * getGraph はページ状態の graph 再利用 + 他年度 fetch（呼び出し側でキャッシュ）を想定。
 */
export function createClientToolExecutor(getGraph: ClientGraphSource): ChatToolExecutor {
  return {
    async getMinistryNames(year) {
      return ministryNamesFromGraph(await getGraph(year));
    },

    executeQuery(input, defaultYear) {
      return executeQueryWithGraph(getGraph, input, defaultYear);
    },

    compareYears(query, baseYear, compareYear) {
      return executeCompareYearsWithGraph(getGraph, query, baseYear, compareYear);
    },

    async searchProjects(year, q, scope) {
      const r = await fetchApi(`/api/search/projects?q=${encodeURIComponent(q)}&year=${year}&limit=${SEARCH_LIMIT}&scope=${scope}`);
      if ('fetchError' in r || r.status !== 200) return apiError(r);
      const json = r.json as {
        metadata?: { totalHits?: number };
        items?: { pid: string; name: string; ministry: string; budgetAmount: number; spendTotal: number; matchedIn: string }[];
      };
      return {
        totalHits: json.metadata?.totalHits ?? 0,
        items: (json.items ?? []).map(i => ({
          pid: i.pid,
          name: i.name,
          ministry: i.ministry,
          budgetAmount: i.budgetAmount,
          spendTotal: i.spendTotal,
          matchedIn: i.matchedIn,
        })),
      };
    },

    async searchRecipients(year, q) {
      const r = await fetchApi(`/api/search/recipients?q=${encodeURIComponent(q)}&year=${year}&limit=${SEARCH_LIMIT}`);
      if ('fetchError' in r || r.status !== 200) return apiError(r);
      const json = r.json as {
        metadata?: { totalHits?: number };
        items?: { name: string; corporateNumber: string | null; directAmount: number; subcontractAmount: number }[];
      };
      return {
        totalHits: json.metadata?.totalHits ?? 0,
        items: (json.items ?? []).map(i => ({
          name: i.name,
          corporateNumber: i.corporateNumber,
          directAmount: i.directAmount,
          subcontractAmount: i.subcontractAmount,
        })),
      };
    },

    async searchSpending(year, q) {
      const r = await fetchApi(`/api/search/spending?q=${encodeURIComponent(q)}&year=${year}&limit=${SEARCH_LIMIT}`);
      if ('fetchError' in r || r.status !== 200) return apiError(r);
      const json = r.json as {
        metadata?: { totalHits?: number };
        aggregate?: {
          hitCount: number; projectCount: number; amountDirect: number; amountSubcontract: number;
          topProjects: { pid: string; name: string | null; ministry: string | null; amountDirect: number; amountSubcontract: number }[];
        };
        items?: { pid: string; name: string | null; recipientName: string; amount: number | null; depth: number; matchedIn: string; excerpt: string }[];
      };
      const payload = {
        totalHits: json.metadata?.totalHits ?? 0,
        aggregate: {
          hitCount: json.aggregate?.hitCount ?? 0,
          projectCount: json.aggregate?.projectCount ?? 0,
          amountDirect: json.aggregate?.amountDirect ?? 0,
          amountSubcontract: json.aggregate?.amountSubcontract ?? 0,
          topProjects: (json.aggregate?.topProjects ?? []).map(p => ({
            pid: p.pid,
            name: p.name,
            ministry: p.ministry,
            amountDirect: p.amountDirect,
            amountSubcontract: p.amountSubcontract,
          })),
        },
        items: (json.items ?? []).map(i => ({
          pid: i.pid,
          name: i.name,
          recipientName: i.recipientName,
          amount: i.amount,
          depth: i.depth,
          matchedIn: i.matchedIn,
          excerpt: i.excerpt,
        })),
      };
      return clampPayload(payload, ['items']);
    },

    async getProjectDetail(year, pid) {
      const [scoreRes, detailRes] = await Promise.all([
        fetchApi(`/api/quality-scores/${encodeURIComponent(pid)}?year=${year}`),
        fetchApi(`/api/project-details/${encodeURIComponent(pid)}?year=${year}`),
      ]);
      const score = !('fetchError' in scoreRes) && scoreRes.status === 200
        ? (scoreRes.json as { score?: QualityScoreProjection }).score ?? null
        : null;
      const detail = !('fetchError' in detailRes) && detailRes.status === 200
        ? detailRes.json as {
            projectName?: string; ministry?: string; bureau?: string; category?: string | null;
            startYear?: number | null; endYear?: number | null; majorExpense?: string | null;
            implementationMethods?: string[] | null; purpose?: string; currentIssues?: string; overview?: string;
          }
        : null;
      if (!score && !detail) {
        // 「見つかりません」と言えるのは両方が明確に 404 のときだけ。
        // タイムアウト・5xx 等の障害は API エラーとして正直に伝える（偽の not-found を返さない）
        const hardFailure = [scoreRes, detailRes].find(
          r => 'fetchError' in r || (r.status !== 200 && r.status !== 404),
        );
        if (hardFailure) return apiError(hardFailure);
        return { error: `pid=${pid} の事業が見つかりません`, hint: 'search_projects で事業名からpidを特定してください' };
      }
      return {
        pid,
        name: score?.name ?? detail?.projectName ?? null,
        ministry: score?.ministry ?? detail?.ministry ?? null,
        bureau: score?.bureau ?? detail?.bureau ?? null,
        budgetAmount: score?.budgetAmount ?? null,
        execAmount: score?.execAmount ?? null,
        spendTotal: score?.spendTotal ?? null,
        totalScore: score?.totalScore ?? null,
        category: detail?.category ?? null,
        startYear: detail?.startYear ?? null,
        endYear: detail?.endYear ?? null,
        majorExpense: detail?.majorExpense ?? null,
        implementationMethods: detail?.implementationMethods ?? null,
        purpose: clampText(detail?.purpose),
        currentIssues: clampText(detail?.currentIssues),
        overview: clampText(detail?.overview),
      };
    },

    async getQualityScores(year, pidsRaw) {
      const validated = validateQualityScorePids(pidsRaw);
      if ('error' in validated) return validated;
      const r = await fetchApi(`/api/quality-scores?year=${year}&pids=${encodeURIComponent(validated.pids.join(','))}`);
      if ('fetchError' in r || r.status !== 200) return apiError(r);
      const json = r.json as { metadata?: { missingPids?: string[] }; items?: QualityScoreProjection[] };
      const found = new Map((json.items ?? []).map(i => [i.pid, i]));
      // サーバ実装と同じく、見つからない pid は { pid, error } のプレースホルダで順序を保つ
      const items = validated.pids.map(pid => {
        const projection = found.get(pid);
        return projection ? stripLinks(projection) : { pid, error: '見つかりません' };
      });
      const payload: { items: unknown[]; notice?: string } = { items };
      if (validated.notice) payload.notice = validated.notice;
      return clampPayload(payload, ['items']);
    },

    async getRecipientDetail(year, key) {
      const r = await fetchApi(`/api/recipients/${encodeURIComponent(key)}?year=${year}&limit=200`);
      const notFound = { error: `key=${key} の支出先が見つかりません`, hint: 'search_recipients で名称からキー（corporateNumber等）を特定してください' };
      if ('fetchError' in r || r.status !== 200) return apiError(r, notFound);
      const json = r.json as {
        metadata?: { appearanceTotal?: number };
        recipient?: {
          key: string; name: string; corporateNumber: string | null;
          totals: unknown; byMinistry: unknown[];
          appearances: { pid: string; projectName: string; ministry: string; blockId: string; originKind: string; amount: number }[];
        };
      };
      const entry = json.recipient;
      if (!entry) return notFound;
      const topAppearances = [...entry.appearances]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, DETAIL_TOP_LIMIT)
        .map(a => ({
          pid: a.pid,
          projectName: a.projectName,
          ministry: a.ministry,
          blockId: a.blockId,
          originKind: a.originKind,
          amount: a.amount,
        }));
      return clampPayload(
        {
          key: entry.key,
          name: entry.name,
          corporateNumber: entry.corporateNumber,
          totals: entry.totals,
          byMinistry: stripLinks(entry.byMinistry),
          appearanceCount: json.metadata?.appearanceTotal ?? entry.appearances.length,
          topAppearances,
        },
        ['byMinistry', 'topAppearances'],
      );
    },

    async getSubcontractChain(year, pid) {
      const r = await fetchApi(`/api/subcontracts/${encodeURIComponent(pid)}?year=${year}`);
      const notFound = {
        error: `pid=${pid} の再委託データが見つかりません`,
        hint: '再委託の記載がない事業（直接支出のみ）の可能性があります。search_projects でpidを確認してください',
      };
      if ('fetchError' in r || r.status !== 200) return apiError(r, notFound);
      // API 応答は SubcontractGraph + metadata/links 追記。整形は共有ロジックに委譲する
      return shapeSubcontractChain(pid, r.json as SubcontractGraph);
    },

    async getHighlights(year, metricRaw) {
      const validated = validateHighlightMetric(metricRaw);
      if ('error' in validated) return validated;
      const metricParam = validated.metric ? `&metric=${validated.metric}` : '';
      const r = await fetchApi(`/api/highlights?year=${year}${metricParam}`);
      if ('fetchError' in r || r.status !== 200) return apiError(r);
      // API 応答は HighlightsResult と同形（+ links/metadata）。links を落として共有整形に委譲する
      const stripped = stripLinks(r.json) as HighlightsResult;
      return shapeHighlights(stripped, validated.metric);
    },
  };
}
