import { NextRequest, NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import type { TaxParameters } from '@/types/tax-burden';

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get('fy') ?? '2025';
  if (year !== '2025') return NextResponse.json({ error: '現在の試作は2025年版のみです' }, { status: 400 });
  try {
    return NextResponse.json(readDataJson<TaxParameters>(`tax-burden-params-${year}.json`, 'npm run generate-tax-burden-data'),
      { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: '計算データを読み込めませんでした。データ生成後に再試行してください。' }, { status: 503 });
  }
}
