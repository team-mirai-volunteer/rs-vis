import { NextResponse } from 'next/server';
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { RsApiDetail } from '@/types/rs-api';

let cache: Record<string, RsApiDetail> | null = null;
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
  cache ??= tryReadDataJson<Record<string, RsApiDetail>>('rs-api-2026-details.json');
  const detail = cache?.[String(Number(projectId))];
  if (!detail) return NextResponse.json({ error: '暫定データ未収録' }, { status: 404 });
  return NextResponse.json(detail, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
