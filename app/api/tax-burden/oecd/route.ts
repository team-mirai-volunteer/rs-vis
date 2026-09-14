import { NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import type { OecdDataset } from '@/types/tax-burden';

export async function GET() {
  try {
    return NextResponse.json(readDataJson<OecdDataset>('tax-burden-oecd-2025.json', 'python scripts/generate-tax-burden-stats.py'),
      { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: 'OECD比較データを読み込めませんでした。' }, { status: 503 });
  }
}
