import { NextRequest, NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import type { TaxRevenue } from '@/types/tax-burden';

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get('fy') ?? '2025';
  if (!/^(201[7-9]|202[0-6])$/.test(year)) return NextResponse.json({ error: '年度は2017〜2026を指定してください' }, { status: 400 });
  try {
    const revenue = readDataJson<TaxRevenue>(`tax-revenue-${year}.json`, 'npm run generate-tax-burden-data');
    return NextResponse.json(revenue, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: '税目別歳入データを読み込めませんでした。再読み込みしてください。' }, { status: 503 });
  }
}
