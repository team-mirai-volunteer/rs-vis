import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { buildProjectMapSpending, crossYearAnchors, withAnchors } from '@/app/lib/project-map-spending';
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
const rawCache = new Map<string, { map: ProjectMapFile; data: ProjectMapSpendingResponse }>();

class MapNotGenerated extends Error {}

function loadRaw(year: string) {
  const cached = rawCache.get(year);
  if (cached) return cached;
  const map = readDataJson<ProjectMapFile>(`project-map-${year}.json`);
  if (!map) return null;
  const pids = new Set(map.points.map(p => String(p.pid)));
  const raw = { map, data: buildProjectMapSpending(loadSankeyGraph(year), pids, Number(year)) };
  rawCache.set(year, raw);
  return raw;
}

/**
 * 年度をまとめて配置したマップ（params.jointYears）では、支出先の位置も全年度の支払いから決めて
 * 年度を切り替えても動かないようにする（事業は同じ座標なので、重心も同じ座標系で取れる）
 */
function loadData(year: string): ProjectMapSpendingResponse {
  const cached = cache.get(year);
  if (cached) return cached;
  const own = loadRaw(year);
  if (!own) throw new MapNotGenerated();
  const years = (own.map.params.jointYears ?? [Number(year)]).map(String);
  const all = years.map(y => (y === year ? own : loadRaw(y))).filter((r): r is NonNullable<typeof r> => r !== null);
  const coords = new Map<string, { x: number; y: number }>();
  for (const r of all) for (const p of r.map.points) if (!coords.has(String(p.pid))) coords.set(String(p.pid), { x: p.x, y: p.y });
  const result = withAnchors(own.data, crossYearAnchors(all.map(r => r.data), coords));
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
