import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────────
export interface EntityLabelItem {
  name: string;
  l1: string | null;
  l2: string | null;
  source: 'dict' | 'kaku' | 'both' | 'none' | 'cn_lookup';
  amount: number;
  count: number;
  cn: string;
  typeCodes: string[];
}

export interface EntityLabelsCsvResponse {
  items: EntityLabelItem[];
  summary: {
    total: number;
    labeled: number;
    labeledAmount: number;
    totalAmount: number;
    byL1: Record<string, { count: number; amount: number }>;
    bySource: Record<'dict' | 'kaku' | 'both' | 'none' | 'cn_lookup', { count: number }>;
  };
}

// ─────────────────────────────────────────────────────────────
// サーバーキャッシュ
// ─────────────────────────────────────────────────────────────
let cached: EntityLabelsCsvResponse | null = null;

function loadData(): EntityLabelsCsvResponse {
  if (cached) return cached;

  const jsonPath = path.join(process.cwd(), 'public', 'data', 'entity-labels-csv.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      'entity-labels-csv.json が見つかりません。' +
      'python3 scripts/generate-entity-labels-csv.py を実行してください。'
    );
  }

  const items: EntityLabelItem[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // サマリー計算
  let labeled = 0;
  let labeledAmount = 0;
  let totalAmount = 0;
  const byL1: Record<string, { count: number; amount: number }> = {};
  const bySource: Record<string, { count: number }> = {
    dict:      { count: 0 },
    kaku:      { count: 0 },
    both:      { count: 0 },
    cn_lookup: { count: 0 },
    none:      { count: 0 },
  };

  for (const item of items) {
    totalAmount += item.amount;

    if (item.source !== 'none') {
      labeled++;
      labeledAmount += item.amount;
    }

    bySource[item.source].count++;

    const l1 = item.l1 ?? 'ラベルなし';
    if (!byL1[l1]) byL1[l1] = { count: 0, amount: 0 };
    byL1[l1].count++;
    byL1[l1].amount += item.amount;
  }

  cached = {
    items,
    summary: {
      total: items.length,
      labeled,
      labeledAmount,
      totalAmount,
      byL1,
      bySource: bySource as EntityLabelsCsvResponse['summary']['bySource'],
    },
  };

  return cached;
}

// ─────────────────────────────────────────────────────────────
// GET ハンドラ
// ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const data = loadData();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
