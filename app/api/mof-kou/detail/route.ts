/**
 * 項1件ぶんの詳細（事項一覧・目一覧・紐づくRS事業一覧）。行の展開時にのみ取得する
 * （一覧APIには含めない。全項ぶんの事項・目を毎回同梱すると数十MBになるため）。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, sectionDetail } from '@/app/lib/api/mof-kou-loader';

/**
 * GET /api/mof-kou/detail
 *
 * クエリ:
 *   year — 会計年度（西暦）。必須
 *   id — 項の合成キー（一覧APIの sections[].id）。必須
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const yearRaw = url.searchParams.get('year');
    const id = url.searchParams.get('id');
    if (!yearRaw || !id) {
      return NextResponse.json({ error: 'year と id を指定してください' }, { status: 400 });
    }
    const year = Number(yearRaw);
    if (isNaN(year) || !availableYears().includes(year)) {
      return NextResponse.json({ error: `対象外の年度です: ${yearRaw}` }, { status: 400 });
    }

    const detail = sectionDetail(year, id);
    if (!detail) {
      return NextResponse.json({ error: `該当する項が見つかりません: ${id}` }, { status: 404 });
    }

    return NextResponse.json(detail, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-kou/detail', error);
  }
}
