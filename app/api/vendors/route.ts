/**
 * 事業者別の横断集計
 *   GET /api/vendors              一覧（契約額が VENDOR_LIST_MIN_CONTRACT 以上の事業者。全年度の合計だけの軽い行）
 *   GET /api/vendors?key=法人番号  その事業者の全項目（年度別・府省別・1者応札が続く事業）
 *   GET /api/vendors?q=名前        名前・法人番号で検索（一覧の下限未満の事業者も対象。上位 VENDOR_SEARCH_LIMIT 件）
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadVendors } from '@/app/lib/api/vendors-loader';
import { matchVendor, toVendorRow, VENDOR_LIST_MIN_CONTRACT, VENDOR_SEARCH_LIMIT } from '@/app/lib/vendors';

export async function GET(req: NextRequest) {
  try {
    const data = loadVendors();
    if (!data) return NextResponse.json({ error: '事業者データがありません（scripts/generate-vendors.ts）' }, { status: 404 });
    const params = req.nextUrl.searchParams;
    const key = params.get('key');
    const q = params.get('q')?.trim();
    if ((key && key.length > 220) || (q && q.length > 200)) return NextResponse.json({ error: 'key / q が不正です' }, { status: 400 });
    const headers = { 'Cache-Control': API_CACHE_CONTROL };
    if (key) {
      const vendor = data.vendors.find(v => v.key === key) ?? null;
      return NextResponse.json({ metadata: data.metadata, vendor }, { headers });
    }
    if (q) {
      const rows = data.vendors.filter(v => matchVendor(v, q)).slice(0, VENDOR_SEARCH_LIMIT).map(toVendorRow);
      return NextResponse.json({ metadata: data.metadata, rows, limit: VENDOR_SEARCH_LIMIT }, { headers });
    }
    const rows = data.vendors.filter(v => v.total.contractAmount >= VENDOR_LIST_MIN_CONTRACT).map(toVendorRow);
    return NextResponse.json({ metadata: data.metadata, rows, minContract: VENDOR_LIST_MIN_CONTRACT, totalVendors: data.vendors.length }, { headers });
  } catch (e) {
    return serverErrorResponse('vendors', e);
  }
}
