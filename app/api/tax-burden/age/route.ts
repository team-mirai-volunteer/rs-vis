import { NextRequest, NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import type { AgeDataset } from '@/types/tax-burden';

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get('year') ?? '2024';
  if (year !== '2024') return NextResponse.json({ error: '家計調査の収録年は2024年のみです' }, { status: 400 });
  try {
    return NextResponse.json(readDataJson<AgeDataset>(`tax-burden-age-${year}.json`, 'python scripts/generate-tax-burden-stats.py'),
      { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: '年齢階級別データを読み込めませんでした。' }, { status: 503 });
  }
}
