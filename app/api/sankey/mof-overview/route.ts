/**
 * MOF予算全体ビューのAPIエンドポイント
 */

import { NextResponse } from 'next/server';
import type { MOFBudgetData } from '@/types/mof-budget-overview';
import { generateMOFBudgetOverviewSankey } from '@/app/lib/mof-sankey-generator';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { readDataJson } from '@/app/lib/api/data-file';

// キャッシュ用
let cachedData: ReturnType<typeof generateMOFBudgetOverviewSankey> | null =
  null;
let lastLoadTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1時間

/**
 * MOFデータを読み込む
 */
function loadMOFBudgetData(): MOFBudgetData {
  return readDataJson<MOFBudgetData>(
    'mof-budget-overview-2023.json',
    'npm run generate-mof-data を実行してください。'
  );
}

/**
 * GET /api/sankey/mof-overview
 */
export async function GET() {
  try {
    // キャッシュチェック
    const now = Date.now();
    if (cachedData && now - lastLoadTime < CACHE_DURATION) {
      console.log('[MOF Overview API] Using cached data');
      return NextResponse.json(cachedData, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
    }

    console.log('[MOF Overview API] Loading fresh data');

    // MOFデータ読み込み
    const mofData = loadMOFBudgetData();

    // サンキー図データ生成
    const sankeyData = {
      ...generateMOFBudgetOverviewSankey(mofData),
      links: { web: '/mof-budget-overview' },
    };

    // キャッシュ更新
    cachedData = sankeyData;
    lastLoadTime = now;

    return NextResponse.json(sankeyData, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('sankey/mof-overview', error);
  }
}
