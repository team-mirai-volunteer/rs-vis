import { NextRequest, NextResponse } from 'next/server';
import { getQualityScore, toQualityScoreProjection } from '@/app/lib/api/quality-scores-loader';
import { parseYear, buildMetadata, QUALITY_SCORE_NOTES, API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks } from '@/app/lib/api/links';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    const { pid } = await params;
    const year = parseYear(request.nextUrl.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }

    const item = getQualityScore(year, pid);
    if (!item) {
      return NextResponse.json(
        { error: `Quality score not found: pid=${pid}`, hint: '/api/search/projects?q= で事業を検索できます' },
        { status: 404 }
      );
    }

    // ?full=1 でサイドパネルのスコア詳細ダイアログ用に全項目を返す（既定は軽量プロジェクション）
    const full = request.nextUrl.searchParams.get('full') === '1';

    const body = {
      metadata: buildMetadata(year, { pid }, QUALITY_SCORE_NOTES),
      score: full ? item : toQualityScoreProjection(item),
      links: {
        ...projectLinks(pid, year),
        qualityWeb: `/quality?year=${year}`,
      },
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('quality-scores/[pid]', e);
  }
}
