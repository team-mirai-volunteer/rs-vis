import { NextResponse } from 'next/server';
import { loadQualityScores } from '@/app/lib/api/quality-scores-loader';
import { loadProjectDetails } from '@/app/lib/api/project-details-loader';
import { searchProjects, PROJECT_SEARCH_SCOPES, type ProjectSearchScope } from '@/app/lib/search/project-search';
import { parseYear, buildMetadata, API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks, sankeyProjectViewLink } from '@/app/lib/api/links';

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
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '', 10) || 0);
    const sortBy = url.searchParams.get('sort') === 'spending' ? 'spending' : 'budget';

    const scopeParam = url.searchParams.get('scope') ?? 'name';
    if (!PROJECT_SEARCH_SCOPES.includes(scopeParam as ProjectSearchScope)) {
      return NextResponse.json(
        { error: `scope は "name" または "details" を指定してください（受領値: ${scopeParam}）` },
        { status: 400 },
      );
    }
    const scope = scopeParam as ProjectSearchScope;

    const { items: allItems } = loadQualityScores(year);
    const projectDetails = scope === 'details' ? loadProjectDetails(year) : undefined;
    const { totalHits, items } = searchProjects(allItems, q, { limit, offset, sortBy, scope, projectDetails });

    const nextOffset = offset + limit < totalHits ? offset + limit : null;
    const body = {
      metadata: buildMetadata(year, { query: q, scope, totalHits, limit, offset, sortBy }),
      items: items.map(({ item: i, matchedIn }) => ({
        pid: i.pid,
        name: i.name,
        ministry: i.ministry,
        bureau: i.bureau,
        budgetAmount: i.budgetAmount,
        execAmount: i.execAmount,
        spendTotal: i.spendTotal,
        hasRedelegation: i.hasRedelegation,
        redelegationDepth: i.redelegationDepth,
        matchedIn,
        links: {
          ...projectLinks(i.pid, year),
          sankeyView: sankeyProjectViewLink(i.name, year),
        },
      })),
      links: {
        next: nextOffset != null
          ? `/api/search/projects?q=${encodeURIComponent(q)}&year=${year}&limit=${limit}&offset=${nextOffset}&sort=${sortBy}&scope=${scope}`
          : null,
      },
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('search/projects', e);
  }
}
