/**
 * 目の経年推移APIエンドポイント。
 *
 * 科目別内訳は年度ごとに別ファイルなので、1件の目について全年度を横断して集める。
 * ロジックは app/lib/api/mof-kou-moku-loader.ts に置き、ここは HTTP の入出力だけ
 * （`/api/mof-jikou/history` と同じ構成）。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, buildHistory } from '@/app/lib/api/mof-kou-moku-loader';

/**
 * GET /api/mof-kou-moku/history
 *
 * クエリ:
 *   key — 目の合成キー（`MOFKouMokuItem.key`）。予算種別は無視して同一の目を辿る
 */
export async function GET(request: Request) {
  try {
    if (availableYears().length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-kou-moku を実行してください。' },
        { status: 503 }
      );
    }

    const key = new URL(request.url).searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'key を指定してください' }, { status: 400 });
    }

    const history = buildHistory(key);
    if (history.years.length === 0) {
      return NextResponse.json({ error: `該当する目がありません: ${key}` }, { status: 404 });
    }

    return NextResponse.json(history, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-kou-moku/history', error);
  }
}
