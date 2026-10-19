/**
 * POST /api/sankey/matches
 * SankeyQuery の条件に合う事業 ID（pid）の一覧だけを返す。
 *
 * AI ナビの結果を評価一覧・委託構造・バブル図に当てるとき、一覧の行には無い条件（支出先名・支出額・再委託・会計区分）を
 * サーバー側でサンキー図のグラフデータに対して評価するために使う（グラフは 16MB あるのでブラウザでは読まない）。
 * フィルタの判定は /budget-sankey・AI ツールと同じ buildFilterExcludedIds。LLM は呼ばない。
 *
 * body: { query: SankeyQuery }
 * 200: { year, count, projectIds: string[] }   400: 条件が不正
 */
import { NextResponse } from 'next/server';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { serverErrorResponse } from '@/app/lib/api/api-notes';
import { buildFilterExcludedIds, resolveSankeyQuery } from '@/app/lib/sankey-query';
import type { SankeyQuery } from '@/types/sankey-query';

export async function POST(req: Request) {
  try {
    let body: { query?: SankeyQuery };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'リクエストボディの JSON が不正です' }, { status: 400 });
    }
    if (!body?.query || typeof body.query !== 'object') {
      return NextResponse.json({ error: 'query（SankeyQuery）を指定してください' }, { status: 400 });
    }
    const { query, errors } = resolveSankeyQuery(body.query);
    if (errors.length > 0) return NextResponse.json({ error: errors.join('、') }, { status: 400 });
    const graph = loadSankeyGraph(query.year);
    const excluded = buildFilterExcludedIds(graph.nodes, graph.edges, query.filter) ?? new Set<string>();
    const projectIds: string[] = [];
    for (const node of graph.nodes) {
      if (!node.id.startsWith('project-budget-') || node.aggregated || excluded.has(node.id)) continue;
      const pid = node.projectId ?? Number(node.id.slice('project-budget-'.length));
      if (Number.isFinite(pid)) projectIds.push(String(pid));
    }
    return NextResponse.json({ year: query.year, count: projectIds.length, projectIds }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverErrorResponse('sankey/matches', e);
  }
}
