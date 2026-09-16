import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { priorBudgetHistory } from '@/app/lib/api/prior-budget-history';

/**
 * 前年度の執行実績だけを最小限で返す API。
 *
 * 政策評価の縮小判定で「単年度の不用」と「2年連続の構造的な計上過大」を区別するために使う。
 * 品質スコア本体（1事業あたり40項目超）をもう1年度分クライアントへ送ると
 * ペイロードが倍増するため、ここでは pid → 執行率・繰越控除後の不用率を返す。
 * 5,000事業でも数十KB に収まる。
 */
export interface ExecutionHistoryResponse {
  /** 基準年度（リクエストされた年度） */
  year: string;
  /** 比較対象の前年度。データが無ければ null */
  priorYear: string | null;
  /**
   * pid → 前年度の執行率（執行額 / 予算額・判定前は丸めない）。
   * 前年度に予算額・執行額の実績がある事業のみ含む。含まれない pid は「判定不能」。
   */
  priorExecutionRates: Record<string, number>;
  priorUnusedRatios: Record<string, number>;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    return NextResponse.json({ year, ...priorBudgetHistory(year) }, {
      headers: { 'Cache-Control': API_CACHE_CONTROL },
    });
  } catch (e) {
    return serverErrorResponse('execution-history', e);
  }
}
