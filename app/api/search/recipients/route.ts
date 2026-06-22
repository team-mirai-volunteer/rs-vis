import { NextResponse } from 'next/server';
import { loadRecipientIndex } from '@/app/lib/api/recipient-index-loader';
import { searchRecipients } from '@/app/lib/search/recipient-search';
import { parseYear, buildMetadata, API_CACHE_CONTROL, RECIPIENT_NOTES, serverErrorResponse } from '@/app/lib/api/api-notes';
import { recipientLinks, sankeyRecipientViewLink } from '@/app/lib/api/links';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    if (!q.trim()) {
      return NextResponse.json({ error: 'q パラメータが必要です' }, { status: 400 });
    }
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') ?? '', 10) || DEFAULT_LIMIT));

    const index = loadRecipientIndex(year);
    const { totalHits, items } = searchRecipients(index.recipients, q, limit);

    const body = {
      metadata: buildMetadata(year, { query: q, totalHits, limit }, RECIPIENT_NOTES),
      items: items.map(e => ({
        key: e.key,
        name: e.name,
        corporateNumber: e.corporateNumber,
        directAmount: e.totals.directAmount,
        directCount: e.totals.directCount,
        subcontractAmount: e.totals.subcontractAmount,
        subcontractCount: e.totals.subcontractCount,
        projectCount: new Set(e.appearances.map(a => a.pid)).size,
        links: {
          ...recipientLinks(e.key, year),
          sankeyView: sankeyRecipientViewLink(e.name, year),
        },
      })),
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('search/recipients', e);
  }
}
