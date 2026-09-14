import { NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import type { IncidenceDataset } from '@/types/tax-burden';

export async function GET() {
  try {
    return NextResponse.json(readDataJson<IncidenceDataset>('tax-burden-incidence.json', 'python scripts/generate-tax-burden-stats.py'),
      { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: '法人税の帰着データを読み込めませんでした。' }, { status: 503 });
  }
}
