import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadBudgetRequests } from '@/app/lib/api/budget-requests-loader';
import { budgetRequestResponse, parseBudgetRequestFilters } from '@/app/lib/budget-requests';

/** GET /api/budget-requests?fy=2027&q=&ministry=&status=&type=&kind=&page=1&limit=50 */
export async function GET(request: NextRequest) {
  let filters;
  try { filters = parseBudgetRequestFilters(request.nextUrl.searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '検索条件が不正です' }, { status: 400 }); }
  try {
    const data = loadBudgetRequests();
    if (!data) return NextResponse.json({ error: '2027年度の概算要求データはまだ取得されていません。', code: 'DATA_NOT_AVAILABLE' }, { status: 404 });
    return NextResponse.json(budgetRequestResponse(data, filters), { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) { return serverErrorResponse('budget-requests', error); }
}
