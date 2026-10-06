/**
 * 独立行政法人のセグメントシート
 *   GET /api/agency-segments?pid=1234[&year=2025]  その事業に結びつくセグメント（指定年度が無ければ最新の年度）
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadAgencySegments, segmentsOfProject } from '@/app/lib/api/agency-segments-loader';

export async function GET(req: NextRequest) {
  try {
    const data = loadAgencySegments();
    if (!data) return NextResponse.json({ error: 'セグメントシートのデータがありません（scripts/generate-agency-segments.ts）' }, { status: 404 });
    const pid = req.nextUrl.searchParams.get('pid');
    const year = req.nextUrl.searchParams.get('year');
    if (!pid || !/^\d{1,12}$/.test(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });
    if (year && !/^\d{4}$/.test(year)) return NextResponse.json({ error: 'year が不正です' }, { status: 400 });
    const segments = segmentsOfProject(data, String(Number(pid)), year ? Number(year) : undefined);
    return NextResponse.json({ metadata: data.metadata, segments }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('agency-segments', e);
  }
}
