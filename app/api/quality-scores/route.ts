import { NextResponse } from 'next/server';
import {
  loadQualityScores,
  getQualityScore,
  toQualityScoreProjection,
} from '@/app/lib/api/quality-scores-loader';
import { parseYear, buildMetadata, QUALITY_SCORE_NOTES, API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks } from '@/app/lib/api/links';

// 型の正典は app/lib/api/quality-scores-loader.ts（/quality ページ等はそちらを import する）
export type { QualityScoreItem, QualityScoresResponse } from '@/app/lib/api/quality-scores-loader';

/** pids 指定時の最大件数（URL長・応答サイズの上限として十分な値） */
const MAX_PIDS = 300;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }

    // pids=1,2,3 指定時: 該当事業のみの軽量プロジェクションを返す（エージェント探索用・数KB）
    const pidsParam = url.searchParams.get('pids');
    if (pidsParam !== null) {
      const pids = [...new Set(pidsParam.split(',').map(s => s.trim()).filter(Boolean))];
      if (pids.length === 0) {
        return NextResponse.json({ error: 'pids には予算事業IDをカンマ区切りで指定してください（例: pids=1900,4752）' }, { status: 400 });
      }
      if (pids.length > MAX_PIDS) {
        return NextResponse.json({ error: `pids は最大${MAX_PIDS}件までです（受領: ${pids.length}件）` }, { status: 400 });
      }
      const found = pids
        .map(pid => getQualityScore(year, pid))
        .filter((i): i is NonNullable<typeof i> => i != null);
      const foundPids = new Set(found.map(i => i.pid));
      const body = {
        metadata: buildMetadata(year, {
          requestedPids: pids.length,
          foundPids: found.length,
          missingPids: pids.filter(p => !foundPids.has(p)),
        }, QUALITY_SCORE_NOTES),
        items: found.map(i => ({
          ...toQualityScoreProjection(i),
          links: projectLinks(i.pid, year),
        })),
      };
      return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
    }

    // 未指定時: 従来どおり全件 + summary（/quality ページ用・後方互換）
    const data = loadQualityScores(year);
    return NextResponse.json(data, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('quality-scores', e);
  }
}
