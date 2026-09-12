/**
 * 項単位「項→目→RS事業→支出先」サンキー。
 *
 * データ源は `sectionDetail`（項→目・目↔RS事業紐づけ）と、RS事業ぶんの
 * `loadSubcontracts`/`loadProjectBudgetComposition`（RS事業→支出先・事業自体の規模）。
 * 組み立ては `app/lib/mof-kou-sankey.ts` に委譲する。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { SUPPORTED_YEARS, type SupportedYear } from '@/app/lib/api/api-notes';
import { availableYears, listSections, sectionDetail } from '@/app/lib/api/mof-kou-loader';
import { linkageRsYear } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';
import { loadSubcontracts, loadProjectBudgetComposition } from '@/app/lib/api/subcontracts-loader';
import { buildMOFKouSankey, directRecipientsOf } from '@/app/lib/mof-kou-sankey';

/**
 * GET /api/mof-kou/[id]/sankey
 *
 * クエリ:
 *   year — 会計年度（西暦）。必須
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = decodeURIComponent(rawId);

    const url = new URL(request.url);
    const yearRaw = url.searchParams.get('year');
    if (!yearRaw) {
      return NextResponse.json({ error: 'year を指定してください' }, { status: 400 });
    }
    const fiscalYear = Number(yearRaw);
    if (isNaN(fiscalYear) || !availableYears().includes(fiscalYear)) {
      return NextResponse.json({ error: `対象外の年度です: ${yearRaw}` }, { status: 400 });
    }

    const list = listSections(fiscalYear);
    const summary = list.sections.find(s => s.id === id);
    if (!summary) {
      return NextResponse.json({ error: `該当する項が見つかりません: ${id}` }, { status: 404 });
    }
    const detail = sectionDetail(fiscalYear, id);
    if (!detail) {
      return NextResponse.json({ error: `該当する項が見つかりません: ${id}` }, { status: 404 });
    }

    const rsYear = linkageRsYear(fiscalYear);
    const rsYearSupported =
      rsYear !== null && (SUPPORTED_YEARS as readonly string[]).includes(String(rsYear)) ? (String(rsYear) as SupportedYear) : null;
    const subcontracts = rsYearSupported ? loadSubcontracts(rsYearSupported) : null;

    const projectIds = [...new Set(detail.rsLinks.map(l => l.projectId))];
    const projects = new Map<number, { totalBudget: number; recipients: Array<{ name: string; amount: number }> }>();
    for (const projectId of projectIds) {
      const graph = subcontracts?.[String(projectId)];
      const composition = rsYearSupported ? loadProjectBudgetComposition(rsYearSupported, String(projectId)) : null;
      const contributionFallback = detail.rsLinks
        .filter(l => l.projectId === projectId)
        .reduce((s, l) => s + l.kouMokuAmount, 0);
      projects.set(projectId, {
        totalBudget: composition?.budgetSummary?.totalBudget ?? graph?.budget ?? contributionFallback,
        recipients: graph ? directRecipientsOf(graph) : [],
      });
    }

    const result = buildMOFKouSankey({
      fiscalYear,
      eraLabel: list.metadata.eraLabel,
      budgetType: summary.budgetType,
      rsYear,
      section: { id: summary.id, sectionName: summary.sectionName, ministry: summary.ministry, amount: summary.amount },
      kouMokuItems: detail.kouMokuItems.map(item => ({ key: item.key, subItemName: item.subItemName, amount: item.amount })),
      rsLinks: detail.rsLinks.map(l => ({
        kouMokuKey: l.kouMokuKey,
        projectId: l.projectId,
        projectName: l.projectName,
        kouMokuAmount: l.kouMokuAmount,
      })),
      projects,
    });

    return NextResponse.json(result, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-kou/[id]/sankey', error);
  }
}
