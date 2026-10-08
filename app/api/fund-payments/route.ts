/**
 * 基金シートの支出先
 *   GET /api/fund-payments?fund=<基金の key>  その基金の年度別の支出先グループ
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadFundPayments } from '@/app/lib/api/fund-payments-loader';

export async function GET(req: NextRequest) {
  try {
    const data = loadFundPayments();
    if (!data) return NextResponse.json({ error: '基金の支出先データがありません（scripts/generate-funds.ts）' }, { status: 404 });
    const fund = req.nextUrl.searchParams.get('fund');
    if (!fund || !/^[0-9a-f-]{36}$/.test(fund)) return NextResponse.json({ error: 'fund が不正です' }, { status: 400 });
    return NextResponse.json({ metadata: data.metadata, years: data.funds[fund] ?? {} }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('fund-payments', e);
  }
}
