/**
 * 財務省 予算書・科目別内訳（項・目）APIエンドポイント。
 *
 * 生成は npm run generate-mof-kou-moku（scripts/generate-mof-kou-moku-data.ts）。
 * 行政事業レビューのデータとは独立した、MOF単独のデータセット。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, loadYear } from '@/app/lib/api/mof-kou-moku-loader';

/**
 * GET /api/mof-kou-moku
 *
 * クエリ:
 *   year — 会計年度（西暦）。省略時は収録済みの最新年度
 */
export async function GET(request: Request) {
  try {
    const years = availableYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-kou-moku を実行してください。' },
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

    return NextResponse.json(
      { ...data, metadata: { ...data.metadata, availableYears: years } },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('mof-kou-moku', error);
  }
}
