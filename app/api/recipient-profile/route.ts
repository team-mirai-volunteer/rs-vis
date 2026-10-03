/**
 * 支出先そのものの説明（サンキー図で支出先ノードを選んだときの詳細パネル用）
 *   GET /api/recipient-profile?year=2025&name=株式会社〇〇
 * 支出先インデックス（法人番号・受注額・府省別）と、契約方式の区分ごとの集計を返す。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { resolveRecipient } from '@/app/lib/api/recipient-index-loader';
import { loadContractMethods } from '@/app/lib/api/contract-methods-loader';
import { buildRecipientProfile } from '@/app/lib/recipient-profile';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

const MAX_NAME_CHARS = 200;

export async function GET(req: NextRequest) {
  try {
    const year = parseYear(req.nextUrl.searchParams.get('year'));
    if (year === null) return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    const name = (req.nextUrl.searchParams.get('name') ?? '').trim();
    if (!name || name.length > MAX_NAME_CHARS) return NextResponse.json({ error: 'name が不正です' }, { status: 400 });
    const entry = /^その他/.test(name) ? null : resolveRecipient(year, `name:${normalizeRecipientName(name)}`);
    return NextResponse.json(buildRecipientProfile(name, entry, loadContractMethods(year)), { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('recipient-profile', e);
  }
}
