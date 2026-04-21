/**
 * MOF予算全体ビューのAPIエンドポイント
 */

import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { MOFBudgetData } from '@/types/mof-budget-overview';
import { generateMOFBudgetOverviewSankey } from '@/app/lib/mof-sankey-generator';

// キャッシュ用
let cachedData: ReturnType<typeof generateMOFBudgetOverviewSankey> | null =
  null;
let lastLoadTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1時間

/**
 * MOFデータを読み込む
 */
function loadMOFBudgetData(): MOFBudgetData {
  const dataPath = path.join(
    process.cwd(),
    'public/data/mof-budget-overview-2023.json'
  );

  if (!fs.existsSync(dataPath)) {
    throw new Error(`MOF budget data not found: ${dataPath}`);
  }

  const content = fs.readFileSync(dataPath, 'utf-8');
  return JSON.parse(content) as MOFBudgetData;
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
      return NextResponse.json(cachedData);
    }

    console.log('[MOF Overview API] Loading fresh data');

    // MOFデータ読み込み
    const mofData = loadMOFBudgetData();

    // サンキー図データ生成
    const sankeyData = generateMOFBudgetOverviewSankey(mofData);

    // キャッシュ更新
    cachedData = sankeyData;
    lastLoadTime = now;

    return NextResponse.json(sankeyData);
  } catch (error) {
    console.error('[MOF Overview API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate MOF budget overview data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
