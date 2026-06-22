import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';

// フィールド名は短縮形（JSONサイズ削減のため）
// n=name, b=blockNo, s=status, c=cnFilled, o=opaque
// a2=金額（個別支出額）, r=isRoot
// chain=ブロック委託チェーン("組織→A→B→C"), d=委託深度
// role=事業を行う上での役割（ブロック単位）, cc=契約概要
export interface RecipientRow {
  n: string;
  b: string;
  s: 'valid' | 'gov' | 'supp' | 'invalid' | 'unknown';
  c: boolean;
  o: boolean;
  a2: number | null;
  r: boolean;
  chain: string;
  d: number;
  role: string;
  cc: string;
}

const cache = new Map<string, Record<string, RecipientRow[]>>();

function loadData(year: string): Record<string, RecipientRow[]> {
  if (cache.has(year)) return cache.get(year)!;

  // 展開済み .json を優先。無ければ .gz をその場で展開（prebuild未実行のローカル等でも動く）。
  const base = path.join(process.cwd(), 'public', 'data', `project-quality-recipients-${year}.json`);
  let raw: string;
  if (fs.existsSync(base)) {
    raw = fs.readFileSync(base, 'utf-8');
  } else if (fs.existsSync(`${base}.gz`)) {
    raw = zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8');
  } else {
    throw new Error(
      `project-quality-recipients-${year}.json(.gz) が見つかりません。` +
      `python3 scripts/score-project-quality.py --year ${year} を実行してください。`
    );
  }

  const data: Record<string, RecipientRow[]> = JSON.parse(raw);
  cache.set(year, data);
  return data;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pid = url.searchParams.get('pid');
    if (!pid) {
      return NextResponse.json({ error: 'pid パラメータが必要です' }, { status: 400 });
    }
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }

    const data = loadData(year);
    return NextResponse.json(data[pid] ?? []);
  } catch (e) {
    return serverErrorResponse('quality-scores/recipients', e);
  }
}
