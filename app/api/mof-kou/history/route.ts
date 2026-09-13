/**
 * 項の経年推移API。予算種別・所管を除いた識別子で全年度を横断する
 * （app/lib/api/mof-kou-loader.ts の sectionHistory 参照）。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, sectionHistory } from '@/app/lib/api/mof-kou-loader';

/**
 * GET /api/mof-kou/history
 *
 * クエリ:
 *   year — 会計年度（西暦）。問い合わせ起点の年度。必須
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
      return NextResponse.json({ error: `不正な year です: ${yearRaw}` }, { status: 400 });
    }

    const history = sectionHistory(year, id);
    if (!history) {
      return NextResponse.json({ error: `該当する項が見つかりません: ${id}` }, { status: 404 });
    }

    return NextResponse.json(history, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-kou/history', error);
  }
}
