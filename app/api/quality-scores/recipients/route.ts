import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

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

  const jsonPath = path.join(process.cwd(), 'public', 'data', `project-quality-recipients-${year}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `project-quality-recipients-${year}.json が見つかりません。` +
      `python3 scripts/score-project-quality.py --year ${year} を実行してください。`
    );
  }

  const data: Record<string, RecipientRow[]> = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
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
    const year = url.searchParams.get('year') ?? '2024';

    const data = loadData(year);
    return NextResponse.json(data[pid] ?? []);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
