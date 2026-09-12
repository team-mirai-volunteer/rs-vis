/**
 * 特定のRS事業ぶんの、目単位の紐づけ明細。
 *
 * `/mof-sankey` のサイドパネルで、RS事業ノードを選んだときの「目」タブ用
 * （どの項のどの目からこの事業へ計上されているか）。行の展開時にのみ取得する
 * （main API には個別事業の目単位明細までは含めていないため）。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { linkageAvailable, resolveLinks } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';

/**
 * GET /api/mof-sankey/rs-project
 *
 * クエリ:
 *   year       — 会計年度（西暦）。必須
 *   projectId  — RS事業のプロジェクトID。必須
 *   budgetType — 予算種別。省略時は全予算種別
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const yearRaw = params.get('year');
    const projectIdRaw = params.get('projectId');
    if (!yearRaw || !projectIdRaw) {
      return NextResponse.json({ error: 'year と projectId を指定してください' }, { status: 400 });
    }
    const year = Number(yearRaw);
    const projectId = Number(projectIdRaw);
    if (!Number.isFinite(year) || !Number.isFinite(projectId)) {
      return NextResponse.json({ error: '不正な year / projectId です' }, { status: 400 });
    }
    if (!linkageAvailable(year)) {
      return NextResponse.json({ error: `対象外の年度です: ${yearRaw}` }, { status: 400 });
    }

    const budgetType = params.get('budgetType');
    const { links } = resolveLinks(year);
    const rows = links.filter(l => l.projectId === projectId && (!budgetType || l.mofBudgetType === budgetType));

    return NextResponse.json({ rows }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-sankey/rs-project', error);
  }
}
