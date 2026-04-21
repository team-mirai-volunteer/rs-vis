import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export interface QualityScoreItem {
  pid: string;
  name: string;
  ministry: string;
  bureau: string;
  division: string;
  section: string;
  office: string;
  team: string;
  unit: string;
  rowCount: number;
  recipientCount?: number;
  validCount: number;
  govAgencyCount: number;
  suppValidCount: number;
  invalidCount: number;
  validRatio: number | null;
  cnFilled: number;
  cnEmpty: number;
  cnFillRatio: number | null;
  budgetAmount: number;
  execAmount: number;
  spendTotal: number;
  spendNetTotal: number;
  gapRatio: number | null;
  blockCount: number;
  orphanBlockCount: number;
  hasRedelegation: boolean;
  redelegationDepth: number;
  opaqueRatio: number | null;
  axis1: number | null;
  axis2: number | null;
  axis3: number | null;
  axis4: number | null;
  axis5: number | null;
  totalScore: number | null;
}

export interface QualityScoresResponse {
  items: QualityScoreItem[];
  summary: {
    total: number;
    avgScore: number;
    medianScore: number;
    stddevScore: number;
    modeScore: number;
    ministries: string[];
  };
}

const cache = new Map<string, QualityScoresResponse>();

function loadData(year: string): QualityScoresResponse {
  if (cache.has(year)) return cache.get(year)!;

  const jsonPath = path.join(process.cwd(), 'public', 'data', `project-quality-scores-${year}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `project-quality-scores-${year}.json が見つかりません。` +
      `python3 scripts/score-project-quality.py --year ${year} を実行してください。`
    );
  }

  const items: QualityScoreItem[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const ministries = [...new Set(items.map(i => i.ministry))].sort();
  const scored = items.filter(i => i.totalScore !== null);
  const scores = scored.map(i => i.totalScore as number).sort((a, b) => a - b);
  const avgScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : 0;

  // 中央値
  let medianScore = 0;
  if (scores.length > 0) {
    const mid = Math.floor(scores.length / 2);
    medianScore = scores.length % 2 === 0
      ? (scores[mid - 1] + scores[mid]) / 2
      : scores[mid];
  }

  // 標準偏差
  let stddevScore = 0;
  if (scores.length > 0) {
    const variance = scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / scores.length;
    stddevScore = Math.sqrt(variance);
  }

  // 最頻値（1点刻みでビン化）
  let modeScore = 0;
  if (scores.length > 0) {
    const bins = new Map<number, number>();
    for (const s of scores) {
      const bin = Math.round(s);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const [bin, count] of bins) {
      if (count > maxCount) {
        maxCount = count;
        modeScore = bin;
      }
    }
  }

  const result: QualityScoresResponse = {
    items,
    summary: { total: items.length, avgScore, medianScore, stddevScore, modeScore, ministries },
  };
  cache.set(year, result);
  return result;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = url.searchParams.get('year') ?? '2024';
    const data = loadData(year);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
