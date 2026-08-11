import { NextResponse } from 'next/server';
import { parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadRecipientRows } from '@/app/lib/api/quality-recipients-loader';

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

    const data = loadRecipientRows(year);
    return NextResponse.json(data[pid] ?? []);
  } catch (e) {
    return serverErrorResponse('quality-scores/recipients', e);
  }
}
