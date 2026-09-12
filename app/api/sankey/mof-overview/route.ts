/**
 * MOF 予算全体ビューの API エンドポイント。
 *
 * 生成は npm run generate-mof-data（scripts/generate-mof-budget-overview-data.ts）。
 * サンキーの組み立ては app/lib/mof-sankey-generator.ts に委譲する。
 */

import { NextResponse } from 'next/server';
import { generateMOFBudgetOverviewSankey } from '@/app/lib/mof-sankey-generator';
import { generateTransferDetailSankey } from '@/app/lib/mof-transfer-sankey-generator';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, loadYear } from '@/app/lib/api/mof-budget-overview-loader';

/**
 * GET /api/sankey/mof-overview
 *
 * クエリ:
 *   year — 会計年度（西暦）。省略時は収録済みの最新年度
 *   view — `transfer` を指定すると特別会計の財源内訳を返す。省略時は全体フロー
 */
export async function GET(request: Request) {
  try {
    const years = availableYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-data を実行してください。' },
        { status: 503 }
      );
    }

    const params = new URL(request.url).searchParams;
    const raw = params.get('year');
    const year = raw ? Number(raw) : years[0];
    if (!years.includes(year)) {
      return NextResponse.json(
        { error: `対象外の年度です: ${raw}`, availableYears: years },
        { status: 400 }
      );
    }

    const overview = loadYear(year);
    const isTransferView = params.get('view') === 'transfer';
    const data = isTransferView
      ? generateTransferDetailSankey(overview)
      : generateMOFBudgetOverviewSankey(overview);

    // 年度切替の選択肢はクライアントが持たないので、応答に同梱する
    return NextResponse.json(
      {
        ...data,
        metadata: { ...data.metadata, availableYears: years },
        links: {
          web: isTransferView
            ? '/mof-budget-overview/transfer-detail'
            : '/mof-budget-overview',
        },
      },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('MOF Overview API', error);
  }
}
