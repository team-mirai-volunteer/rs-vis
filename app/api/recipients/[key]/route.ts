import { NextRequest, NextResponse } from 'next/server';
import { resolveRecipient } from '@/app/lib/api/recipient-index-loader';
import { parseYear, buildMetadata, API_CACHE_CONTROL, RECIPIENT_NOTES, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks, externalCorporateLinks } from '@/app/lib/api/links';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key: rawKey } = await params;
    const key = decodeURIComponent(rawKey);
    const year = parseYear(request.nextUrl.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '', 10) || DEFAULT_LIMIT)
    );

    const entry = resolveRecipient(year, key);
    if (!entry) {
      return NextResponse.json(
        { error: `Recipient not found: ${key}`, hint: '/api/search/recipients?q= で検索できます' },
        { status: 404 }
      );
    }

    const body = {
      metadata: buildMetadata(
        year,
        { key, appearanceTotal: entry.appearances.length, appearanceLimit: limit },
        RECIPIENT_NOTES,
      ),
      recipient: {
        ...entry,
        appearances: entry.appearances.slice(0, limit).map(a => ({
          ...a,
          links: projectLinks(a.pid, year),
        })),
      },
      links: {
        external: entry.corporateNumber ? externalCorporateLinks(entry.corporateNumber) : undefined,
      },
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('recipients/[key]', e);
  }
}
