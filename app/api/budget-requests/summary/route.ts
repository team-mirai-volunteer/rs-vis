import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadBudgetRequestLinks } from '@/app/lib/api/budget-request-links-loader';

/**
 * GET /api/budget-requests/summary
 * 府省・組織別の要求額（明細表の総計行だけを使うので重複しない）と、RS 事業との対応状況。
 */
export async function GET() {
  try {
    const data = loadBudgetRequestLinks();
    if (!data) return NextResponse.json({ error: '概算要求の対応データはまだ生成されていません。', code: 'DATA_NOT_AVAILABLE' }, { status: 404 });
    return NextResponse.json({ requestedFY: data.requestedFY, sheetYear: data.sheetYear, generatedAt: data.generatedAt, crawledMinistries: data.crawledMinistries, ministries: data.ministries, stats: data.stats },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) { return serverErrorResponse('budget-requests/summary', error); }
}
