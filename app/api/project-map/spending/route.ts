import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { buildProjectMapSpending } from '@/app/lib/project-map-spending';
import type { ProjectMapFile, ProjectMapSpendingResponse } from '@/types/project-map';
import { tryReadDataJson as readDataJson } from '@/app/lib/api/data-file';

/**
 * 事業マップの支出つながり API（/project-bubble の「支出つながり」ビュー用）。
 *
 * サンキー図のグラフ（約16MB）をそのままブラウザに送らず、
 * マップ上の2事業以上に繋がる支出先と、その支出元の事業・金額だけに絞って返す。
 * 座標ファイルが無い年度は /api/project-map と同じく 404。
 */

const cache = new Map<string, ProjectMapSpendingResponse>();

class MapNotGenerated extends Error {}

function loadData(year: string): ProjectMapSpendingResponse {
  const cached = cache.get(year);
  if (cached) return cached;
  const map = readDataJson<ProjectMapFile>(`project-map-${year}.json`);
  if (!map) throw new MapNotGenerated();
  const pids = new Set(map.points.map(p => String(p.pid)));
  const result = buildProjectMapSpending(loadSankeyGraph(year), pids, Number(year));
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
    return NextResponse.json(loadData(year), {
      headers: { 'Cache-Control': API_CACHE_CONTROL },
    });
  } catch (e) {
    if (e instanceof MapNotGenerated) {
      return NextResponse.json(
        { error: 'この年度の事業マップはまだ生成されていません', code: 'MAP_NOT_GENERATED' },
        { status: 404 },
      );
    }
    return serverErrorResponse('project-map/spending', e);
  }
}
