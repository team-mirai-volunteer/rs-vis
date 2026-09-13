/**
 * 財務省 予算書・決算書「事項別内訳」APIエンドポイント。
 *
 * 生成は npm run generate-mof-jikou（scripts/generate-mof-jikou-data.ts）。
 * 行政事業レビューのデータとは独立した、MOF単独のデータセット。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, loadYear } from '@/app/lib/api/mof-jikou-loader';

/**
 * GET /api/mof-jikou
 *
 * クエリ:
 *   year — 会計年度（西暦）。省略時は収録済みの最新年度
 */
export async function GET(request: Request) {
  try {
    const years = availableYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-jikou を実行してください。' },
        { status: 503 }
      );
    }

    const raw = new URL(request.url).searchParams.get('year');
    const year = raw ? Number(raw) : years[0];
    if (!years.includes(year)) {
      return NextResponse.json(
        { error: `対象外の年度です: ${raw}`, availableYears: years },
        { status: 400 }
      );
    }

    const data = loadYear(year);

    // 年度切替の選択肢はクライアントが持たないので、応答に同梱する
    return NextResponse.json(
      { ...data, metadata: { ...data.metadata, availableYears: years } },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('mof-jikou', error);
  }
}
