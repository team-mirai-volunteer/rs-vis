import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { joinProjectMap, type MapQualityRow } from '@/app/lib/project-map';
import type { ProjectMapFile, ProjectMapResponse } from '@/types/project-map';
// パス解決は data-file.ts に一元化する（Vercel の関数バンドルは data/server の .gz のみ）
import { tryReadDataJson as readDataJson } from '@/app/lib/api/data-file';

/**
 * 事業の意味的2次元マップ API（/project-map のバブルチャート用）。
 *
 * /api/quality-scores は1事業40項目超を返すため全件で約9MB あり、
 * 5,794個のバブルを描くためだけに読ませるには重い。
 * ここでは描画に要る11フィールドだけに絞って返す。
 *
 * 座標ファイルが無い年度（AI評価が未生成の年度）は 404 を返す。
 * 年度タブから切り替えたときに、UI 側で「未生成」を出し分けるため。
 */

const cache = new Map<string, ProjectMapResponse>();


type DetailPeriod = { startYear?: number | null };

/** 事業詳細の開始年度から継続年数を作る。開始年度が無い事業は載せない＝判定不能 */
function buildYearsRunning(year: string): Record<string, number> {
  const details = readDataJson<Record<string, DetailPeriod>>(`rs${year}-project-details.json`);
  const out: Record<string, number> = {};
  if (!details) return out;
  const target = Number(year);
  for (const [pid, d] of Object.entries(details)) {
    if (d?.startYear) out[pid] = Math.max(1, target - d.startYear + 1);
  }
  return out;
}

/** 前年度の執行率。/api/execution-history と同じ算出（縮小判定の材料） */
function buildPriorExecutionRates(year: string): Record<string, number> {
  const prior = readDataJson<Array<{ pid: string; budgetAmount: number; execAmount: number }>>(
    `project-quality-scores-${Number(year) - 1}.json`,
  );
  const out: Record<string, number> = {};
  if (!prior) return out;
  for (const row of prior) {
    // 執行実績が無い事業（予備的経費・未着手）は「全額不用」ではなく判定対象外
    if (!(row.budgetAmount > 0 && row.execAmount > 0)) continue;
    out[row.pid] = Math.round((row.execAmount / row.budgetAmount) * 1000) / 1000;
  }
  return out;
}

/** 座標ファイルが無い年度を呼び出し側で 404 にするための番兵 */
class MapNotGenerated extends Error {}

function loadData(year: string): ProjectMapResponse {
  const cached = cache.get(year);
  if (cached) return cached;

  const map = readDataJson<ProjectMapFile>(`project-map-${year}.json`);
  if (!map) {
    throw new MapNotGenerated(
      `project-map-${year}.json が見つかりません。` +
      `OPENROUTER_API_KEY=... python3 scripts/generate-project-map.py --year ${year} を実行してください。`,
    );
  }

  const quality = readDataJson<MapQualityRow[]>(`project-quality-scores-${year}.json`);
  if (!quality) {
    throw new Error(`project-quality-scores-${year}.json が見つかりません。`);
  }

  const result = joinProjectMap({
    map,
    quality,
    priorExecutionRates: buildPriorExecutionRates(year),
    yearsRunning: buildYearsRunning(year),
  });
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
    return serverErrorResponse('project-map', e);
  }
}
