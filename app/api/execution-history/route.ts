import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { tryReadDataJson } from '@/app/lib/api/data-file';

/**
 * 前年度の執行実績だけを最小限で返す API。
 *
 * 政策評価の縮小判定で「単年度の不用」と「2年連続の構造的な計上過大」を区別するために使う。
 * 品質スコア本体（1事業あたり40項目超）をもう1年度分クライアントへ送ると
 * ペイロードが倍増するため、ここでは pid → 執行率 だけを返す。
 * 5,000事業でも数十KB に収まる。
 */
export interface ExecutionHistoryResponse {
  /** 基準年度（リクエストされた年度） */
  year: string;
  /** 比較対象の前年度。データが無ければ null */
  priorYear: string | null;
  /**
   * pid → 前年度の執行率（執行額 / 予算額・小数3桁）。
   * 前年度に予算額・執行額の実績がある事業のみ含む。含まれない pid は「判定不能」。
   */
  priorExecutionRates: Record<string, number>;
}

type QualityRow = { pid: string; budgetAmount: number; execAmount: number };

const cache = new Map<string, ExecutionHistoryResponse>();

// パス解決は data-file.ts に一元化する（Vercel の関数バンドルは data/server の .gz のみ）
function readQualityScores(year: string): QualityRow[] | null {
  return tryReadDataJson<QualityRow[]>(`project-quality-scores-${year}.json`);
}

function loadData(year: string): ExecutionHistoryResponse {
  const cached = cache.get(year);
  if (cached) return cached;

  const priorYear = String(Number(year) - 1);
  const rows = readQualityScores(priorYear);
  const priorExecutionRates: Record<string, number> = {};
  if (rows) {
    for (const row of rows) {
      // 執行実績が無い事業（予備的経費・未着手）は「全額不用」ではなく判定対象外とする
      if (!(row.budgetAmount > 0 && row.execAmount > 0)) continue;
      priorExecutionRates[row.pid] = Math.round((row.execAmount / row.budgetAmount) * 1000) / 1000;
    }
  }

  const result: ExecutionHistoryResponse = {
    year,
    priorYear: rows ? priorYear : null,
    priorExecutionRates,
  };
  cache.set(year, result);
  return result;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    return NextResponse.json(loadData(year), {
      headers: { 'Cache-Control': API_CACHE_CONTROL },
    });
  } catch (e) {
    return serverErrorResponse('execution-history', e);
  }
}
