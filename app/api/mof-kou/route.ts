/**
 * 財務省 予算書「項」一覧APIエンドポイント。
 *
 * `/mof-jikou`（事項）・`/mof-kou-moku`（目）・`mof-rs-kou-moku-linkage`（目↔RS紐づけ）を
 * リクエスト時に項単位へ束ねる。専用の生成JSONファイルは持たない
 * （app/lib/api/mof-kou-loader.ts 参照）。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, listSections } from '@/app/lib/api/mof-kou-loader';
import { linkageRsYear } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';

/**
 * GET /api/mof-kou
 *
 * クエリ:
 *   year — 会計年度（西暦）。省略時は収録済みの最新年度
 */
export async function GET(request: Request) {
  try {
    const years = availableYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-budget を実行してください。' },
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

    const data = listSections(year);
    const rsYear = data.metadata.linkage.available ? linkageRsYear(year) : null;

    return NextResponse.json(
      {
        ...data,
        metadata: { ...data.metadata, availableYears: years, linkage: { ...data.metadata.linkage, rsYear } },
      },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('mof-kou', error);
  }
}
