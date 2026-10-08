/**
 * 基金シートのまとめ
 *   GET /api/funds            全基金
 *   GET /api/funds?pid=1234   その事業が造成元・関連の基金
 *   GET /api/funds?owner=名前 その法人が保有する基金
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadFunds } from '@/app/lib/api/funds-loader';
import { fundsHeldBy, fundsOfProject } from '@/app/lib/funds';

export async function GET(req: NextRequest) {
  try {
    const data = loadFunds();
    if (!data) return NextResponse.json({ error: '基金データがありません（scripts/generate-funds.ts）' }, { status: 404 });
    const pid = req.nextUrl.searchParams.get('pid');
    const owner = req.nextUrl.searchParams.get('owner');
    if (pid && !/^\d{1,12}$/.test(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });
    if (owner && owner.length > 200) return NextResponse.json({ error: 'owner が不正です' }, { status: 400 });
    const funds = pid ? fundsOfProject(data.funds, String(Number(pid))) : owner ? fundsHeldBy(data.funds, [owner]) : data.funds;
    return NextResponse.json({ metadata: data.metadata, funds }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('funds', e);
  }
}
