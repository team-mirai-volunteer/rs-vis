import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { parseQualityYear, QUALITY_YEAR_ERROR } from '@/app/lib/api/quality-year';
import { loadQualitySections } from '@/app/lib/api/quality-sections-loader';

export type { QualitySectionItem, QualitySectionsResponse } from '@/types/quality-sections';

/**
 * GET /api/quality-sections?year=2025
 * 予算書の「項」ごとに、その項に紐づく RS事業の政策評価を計上額で加重平均して返す（/quality の「項」表示）。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseQualityYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: QUALITY_YEAR_ERROR }, { status: 400 });
    }
    return NextResponse.json(loadQualitySections(year), { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('quality-sections', e);
  }
}
