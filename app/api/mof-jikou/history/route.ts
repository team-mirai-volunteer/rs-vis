/**
 * 事項の経年推移APIエンドポイント。
 *
 * 事項別内訳は年度ごとに別ファイルなので、1件の事項について全年度を横断して集める。
 * ロジックは app/lib/api/mof-jikou-loader.ts に置き、ここは HTTP の入出力だけ。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, buildHistory } from '@/app/lib/api/mof-jikou-loader';

/**
 * GET /api/mof-jikou/history
 *
 * クエリ:
 *   key — 事項の合成キー（`MOFJikouItem.key`）。予算種別は無視して同一事項を辿る
 */
export async function GET(request: Request) {
  try {
    if (availableYears().length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-jikou を実行してください。' },
        { status: 503 }
      );
    }

    const key = new URL(request.url).searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'key を指定してください' }, { status: 400 });
    }

    const history = buildHistory(key);
    if (history.years.length === 0) {
      return NextResponse.json({ error: `該当する事項がありません: ${key}` }, { status: 404 });
    }

    return NextResponse.json(history, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-jikou/history', error);
  }
}
