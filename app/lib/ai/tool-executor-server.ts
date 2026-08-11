/**
 * AIチャットツールのサーバ実装（ChatToolExecutor）。
 *
 * データはサーバローダ直呼び（fs 読み・メモリキャッシュ）。整形は tool-shaping.ts に
 * 委譲し、クライアント実装（client/lib/ai/client-tool-executor.ts）と応答形を揃える。
 * ここが payload 形の正典（クライアント実装は公開 API 応答をこの形に合わせる）。
 */
import type { SankeyQuery } from '@/types/sankey-query';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import type { ProjectSearchScope } from '@/app/lib/search/project-search';
import { searchProjects } from '@/app/lib/search/project-search';
import { searchRecipients } from '@/app/lib/search/recipient-search';
import { searchSpending } from '@/app/lib/search/spending-search';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { loadQualityScores, getQualityScore, toQualityScoreProjection } from '@/app/lib/api/quality-scores-loader';
import { loadRecipientIndex, resolveRecipient } from '@/app/lib/api/recipient-index-loader';
import { getProjectDetail, loadProjectDetails } from '@/app/lib/api/project-details-loader';
import { loadSubcontracts } from '@/app/lib/api/subcontracts-loader';
import { loadSpendingSearchRows } from '@/app/lib/api/quality-recipients-loader';
import { loadHighlights } from '@/app/lib/api/highlights-loader';
import type { ChatToolExecutor } from '@/app/lib/ai/chat-core';
import {
  SEARCH_LIMIT,
  DETAIL_TOP_LIMIT,
  clampText,
  clampPayload,
  validateQualityScorePids,
  validateHighlightMetric,
  ministryNamesFromGraph,
  executeQueryWithGraph,
  executeCompareYearsWithGraph,
  shapeSubcontractChain,
  shapeHighlights,
} from '@/app/lib/ai/tool-shaping';

export const serverToolExecutor: ChatToolExecutor = {
  getMinistryNames(year) {
    return ministryNamesFromGraph(loadSankeyGraph(year));
  },

  executeQuery(input: SankeyQuery, defaultYear: SupportedYear) {
    return executeQueryWithGraph(loadSankeyGraph, input, defaultYear);
  },

  searchProjects(year, q, scope: ProjectSearchScope) {
    const { items: allItems } = loadQualityScores(year);
    const projectDetails = scope === 'details' ? loadProjectDetails(year) : undefined;
    const { totalHits, items } = searchProjects(allItems, q, { limit: SEARCH_LIMIT, offset: 0, sortBy: 'budget', scope, projectDetails });
    return {
      totalHits,
      items: items.map(({ item: i, matchedIn }) => ({
        pid: i.pid,
        name: i.name,
        ministry: i.ministry,
        budgetAmount: i.budgetAmount,
        spendTotal: i.spendTotal,
        matchedIn,
      })),
    };
  },

  searchRecipients(year, q) {
    const index = loadRecipientIndex(year);
    const { totalHits, items } = searchRecipients(index.recipients, q, SEARCH_LIMIT);
    return {
      totalHits,
      items: items.map(e => ({
        name: e.name,
        corporateNumber: e.corporateNumber,
        directAmount: e.totals.directAmount,
        subcontractAmount: e.totals.subcontractAmount,
      })),
    };
  },

  searchSpending(year, q) {
    const rows = loadSpendingSearchRows(year);
    const { aggregate, totalHits, items } = searchSpending(rows, q, { limit: SEARCH_LIMIT, offset: 0 });
    const payload = {
      totalHits,
      aggregate: {
        hitCount: aggregate.hitCount,
        projectCount: aggregate.projectCount,
        amountDirect: aggregate.amountDirect,
        amountSubcontract: aggregate.amountSubcontract,
        topProjects: aggregate.topProjects.map(p => ({
          pid: p.pid,
          name: getQualityScore(year, p.pid)?.name ?? null,
          ministry: getQualityScore(year, p.pid)?.ministry ?? null,
          amountDirect: p.amountDirect,
          amountSubcontract: p.amountSubcontract,
        })),
      },
      items: items.map(({ row, matchedIn, excerpt }) => ({
        pid: row.pid,
        name: getQualityScore(year, row.pid)?.name ?? null,
        recipientName: row.n,
        amount: row.a2,
        depth: row.d,
        matchedIn,
        excerpt,
      })),
    };
    return clampPayload(payload, ['items']);
  },

  getProjectDetail(year, pid) {
    const score = getQualityScore(year, pid);
    const detail = getProjectDetail(year, pid);
    if (!score && !detail) {
      return { error: `pid=${pid} の事業が見つかりません`, hint: 'search_projects で事業名からpidを特定してください' };
    }
    return {
      pid,
      name: score?.name ?? detail?.projectName ?? null,
      ministry: score?.ministry ?? detail?.ministry ?? null,
      bureau: score?.bureau ?? detail?.bureau ?? null,
      budgetAmount: score?.budgetAmount ?? null,
      execAmount: score?.execAmount ?? null,
      spendTotal: score?.spendTotal ?? null,
      totalScore: score?.totalScore ?? null,
      category: detail?.category ?? null,
      startYear: detail?.startYear ?? null,
      endYear: detail?.endYear ?? null,
      majorExpense: detail?.majorExpense ?? null,
      implementationMethods: detail?.implementationMethods ?? null,
      purpose: clampText(detail?.purpose),
      currentIssues: clampText(detail?.currentIssues),
      overview: clampText(detail?.overview),
    };
  },

  getQualityScores(year, pidsRaw) {
    const validated = validateQualityScorePids(pidsRaw);
    if ('error' in validated) return validated;
    const items = validated.pids.map(pid => {
      const score = getQualityScore(year, pid);
      return score ? toQualityScoreProjection(score) : { pid, error: '見つかりません' };
    });
    const payload: { items: unknown[]; notice?: string } = { items };
    if (validated.notice) payload.notice = validated.notice;
    return clampPayload(payload, ['items']);
  },

  getRecipientDetail(year, key) {
    const entry = resolveRecipient(year, key);
    if (!entry) {
      return { error: `key=${key} の支出先が見つかりません`, hint: 'search_recipients で名称からキー（corporateNumber等）を特定してください' };
    }
    const topAppearances = [...entry.appearances]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, DETAIL_TOP_LIMIT)
      .map(a => ({
        pid: a.pid,
        projectName: a.projectName,
        ministry: a.ministry,
        blockId: a.blockId,
        originKind: a.originKind,
        amount: a.amount,
      }));
    return clampPayload(
      {
        key: entry.key,
        name: entry.name,
        corporateNumber: entry.corporateNumber,
        totals: entry.totals,
        byMinistry: entry.byMinistry,
        appearanceCount: entry.appearances.length,
        topAppearances,
      },
      ['byMinistry', 'topAppearances'],
    );
  },

  getSubcontractChain(year, pid) {
    const index = loadSubcontracts(year);
    const graph = index?.[pid];
    if (!graph) {
      return {
        error: `pid=${pid} の再委託データが見つかりません`,
        hint: '再委託の記載がない事業（直接支出のみ）の可能性があります。search_projects でpidを確認してください',
      };
    }
    return shapeSubcontractChain(pid, graph);
  },

  getHighlights(year, metricRaw) {
    const validated = validateHighlightMetric(metricRaw);
    if ('error' in validated) return validated;
    return shapeHighlights(loadHighlights(year), validated.metric);
  },

  compareYears(query, baseYear, compareYear) {
    return executeCompareYearsWithGraph(loadSankeyGraph, query, baseYear, compareYear);
  },
};
