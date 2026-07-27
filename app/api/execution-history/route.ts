import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';

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

/** 展開済み .json を優先。無ければ .gz をその場で展開する */
function readQualityScores(year: string): QualityRow[] | null {
  const base = path.join(process.cwd(), 'public', 'data', `project-quality-scores-${year}.json`);
  if (fs.existsSync(base)) return JSON.parse(fs.readFileSync(base, 'utf-8'));
  if (fs.existsSync(`${base}.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8'));
  }
  return null;
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
