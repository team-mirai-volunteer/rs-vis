import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadQualityScores } from '@/app/lib/api/quality-scores-loader';
import { loadSubcontracts } from '@/app/lib/api/subcontracts-loader';
import { buildProjectSortMetrics, type ProjectSortMetricsResponse } from '@/app/lib/project-sort-metrics';

/**
 * 事業ごとの継続年数・ブロック差額（RSシート年度）。
 * /budget-sankey の並べ替えと /project-bubble のバブルの大きさ用に、必要な数値だけを短いキーで返す。
 * ブロック差額は記載額の差であり、実際の受取額や利益ではない。
 */
const cache = new Map<string, ProjectSortMetricsResponse>();

export async function GET(req: Request) {
  try {
    const year = parseYear(new URL(req.url).searchParams.get('year'));
    if (year === null) return NextResponse.json({ error: '対応していない年度です' }, { status: 400 });
    let result = cache.get(year);
    if (!result) {
      result = { year: Number(year), items: buildProjectSortMetrics(loadQualityScores(year).items, loadSubcontracts(year)) };
      cache.set(year, result);
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('project-sort-metrics', e);
  }
}
