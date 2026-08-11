import { NextResponse } from 'next/server';
import { loadSpendingSearchRows } from '@/app/lib/api/quality-recipients-loader';
import { getQualityScore } from '@/app/lib/api/quality-scores-loader';
import { searchSpending } from '@/app/lib/search/spending-search';
import { parseYear, buildMetadata, API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks, sankeyProjectViewLink } from '@/app/lib/api/links';
import type { SupportedYear } from '@/app/lib/api/api-notes';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;
const TOP_PROJECTS_LIMIT = 10;

const SPENDING_SEARCH_NOTES: readonly string[] = [
  '検索対象は支出行の role（事業を行う上での役割）と cc（契約概要）のみです（chainなどの経路情報は対象外）',
  'amountDirect（直接支出）とamountSubcontract（再委託）の単純合算は資金の通過分を二重に数えることになります。常に分離して扱ってください',
];

function projectName(year: SupportedYear, pid: string): string | null {
  return getQualityScore(year, pid)?.name ?? null;
}

function projectMinistry(year: SupportedYear, pid: string): string | null {
  return getQualityScore(year, pid)?.ministry ?? null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    if (q.trim().length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ error: `q パラメータは${MIN_QUERY_LENGTH}文字以上で指定してください` }, { status: 400 });
    }
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') ?? '', 10) || DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '', 10) || 0);

    const rows = loadSpendingSearchRows(year);
    const { aggregate, totalHits, items } = searchSpending(rows, q, { limit, offset, topProjectsLimit: TOP_PROJECTS_LIMIT });

    const nextOffset = offset + limit < totalHits ? offset + limit : null;
    const body = {
      metadata: buildMetadata(year, { query: q, totalHits, limit, offset }, SPENDING_SEARCH_NOTES),
      aggregate: {
        hitCount: aggregate.hitCount,
        projectCount: aggregate.projectCount,
        amountDirect: aggregate.amountDirect,
        amountSubcontract: aggregate.amountSubcontract,
        topProjects: aggregate.topProjects.map(p => ({
          pid: p.pid,
          name: projectName(year, p.pid),
          ministry: projectMinistry(year, p.pid),
          amountDirect: p.amountDirect,
          amountSubcontract: p.amountSubcontract,
        })),
      },
      items: items.map(({ row, matchedIn, excerpt }) => {
        const name = projectName(year, row.pid);
        return {
          pid: row.pid,
          name,
          recipientName: row.n,
          corporateNumber: row.cn || null,
          amount: row.a2,
          depth: row.d,
          matchedIn,
          excerpt,
          links: {
            ...projectLinks(row.pid, year),
            sankeyProjectViewLink: name ? sankeyProjectViewLink(name, year) : null,
          },
        };
      }),
      links: {
        next: nextOffset != null
          ? `/api/search/spending?q=${encodeURIComponent(q)}&year=${year}&limit=${limit}&offset=${nextOffset}`
          : null,
      },
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('search/spending', e);
  }
}
