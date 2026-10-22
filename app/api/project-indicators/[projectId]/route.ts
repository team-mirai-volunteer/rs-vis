/**
 * 成果目標・実績 API
 * GET /api/project-indicators/[projectId]?year=2024|2025
 *
 * RS シート 3-1（効果発現経路_目標・実績）の指標を事業単位で返す。
 * 指標が 1 つも無い事業・未生成の年度は 404（画面は節を出さない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { getProjectIndicators } from '@/app/lib/api/project-indicators-loader';
import type { ProjectIndicatorsResponse } from '@/types/project-indicators';

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = parseYear(yearParam);
  if (!/^\d{1,8}$/.test(projectId)) return NextResponse.json({ error: 'projectId が不正です' }, { status: 400 });
  if (year === null) return NextResponse.json({ error: `Unsupported year: ${yearParam}` }, { status: 400 });
  try {
    const data = getProjectIndicators(year, projectId);
    if (!data) return NextResponse.json({ error: '成果目標・実績のデータがありません', code: 'DATA_NOT_AVAILABLE' }, { status: 404 });
    const body: ProjectIndicatorsResponse = { pid: projectId, sheetYear: Number(year), ...data };
    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('project-indicators', error);
  }
}
