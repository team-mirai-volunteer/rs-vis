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
import { loadRecipientRows, loadSpendingSearchRows } from '@/app/lib/api/quality-recipients-loader';
import { loadHighlights } from '@/app/lib/api/highlights-loader';
import type { ChatToolExecutor } from '@/app/lib/ai/chat-core';
import { withContractMethods } from '@/app/lib/api/contract-methods-loader';
import { loadFunds } from '@/app/lib/api/funds-loader';
import { loadSankeyPolicyScores } from '@/app/lib/api/sankey-policy-scores';
import type { SankeyPolicyScores } from '@/app/lib/sankey-query';
import { loadVendors } from '@/app/lib/api/vendors-loader';
import { BUDGET_REQUEST_LINKS_FY, budgetRequestLinksFor } from '@/app/lib/api/budget-request-links-loader';
import { toVendorRow } from '@/app/lib/vendors';
import { shapeBudgetRequest, shapeFund, shapeFundSearch, shapeProjectRecipients, shapeVendor, shapeVendorSearch } from '@/app/lib/ai/tool-shaping-extra';
import { estimateTaxBurdenWith, searchTaxExpenditures, shapeBudgetRequestSearch } from '@/app/lib/ai/tool-shaping-secondary';
import { loadBudgetRequests } from '@/app/lib/api/budget-requests-loader';
import { DEFAULT_REQUEST_FILTERS, filterBudgetRequests } from '@/app/lib/budget-requests';
import { tryReadDataJson } from '@/app/lib/api/data-file';
import taxExpenditureData from '@/app/lib/tax-expenditures/data.json';
import { assessments as taxExpenditureAssessments } from '@/app/lib/tax-expenditures/assessments';
import type { ConsumptionDataset, TaxParameters } from '@/types/tax-burden';
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

/** 年度ごとの政策評価スコア・継続年数・成果指標の件数（filter.scores 等の判定用）。/api/sankey/matches と共用 */
const policyScores = (year: SupportedYear): SankeyPolicyScores => loadSankeyPolicyScores(year);

export const serverToolExecutor: ChatToolExecutor = {
  getMinistryNames(year) {
    return ministryNamesFromGraph(loadSankeyGraph(year));
  },

  executeQuery(input: SankeyQuery, defaultYear: SupportedYear) {
    return executeQueryWithGraph(loadSankeyGraph, input, defaultYear, policyScores);
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

  // ── 段階 C: 支出先一覧・基金・事業者・概算要求（整形は tool-shaping-extra に委譲） ──
  getProjectRecipients(year, pid) {
    const rows = loadRecipientRows(year)[pid];
    if (!rows) return { error: `pid=${pid} の支出先データが見つかりません`, hint: 'search_projects で事業名からpidを特定してください' };
    return shapeProjectRecipients(pid, withContractMethods(rows, pid, year));
  },

  searchFunds(q, pid) {
    const data = loadFunds();
    if (!data) return { error: '基金データがありません' };
    return shapeFundSearch(data.funds, q, pid);
  },

  getFund(key) {
    const fund = loadFunds()?.funds.find(f => f.key === key);
    return fund ? shapeFund(fund) : { error: `key=${key} の基金が見つかりません`, hint: 'search_funds で基金名からキーを特定してください' };
  },

  getVendor(q, key) {
    const data = loadVendors();
    if (!data) return { error: '事業者データがありません' };
    if (key) {
      const vendor = data.vendors.find(v => v.key === key);
      return vendor ? shapeVendor(vendor) : { error: `key=${key} の事業者が見つかりません`, hint: 'get_vendor を q（事業者名）で呼んでキーを特定してください' };
    }
    return shapeVendorSearch(data.vendors.map(toVendorRow), q);
  },

  getBudgetRequest(pid) {
    return shapeBudgetRequest(pid, budgetRequestLinksFor(pid), BUDGET_REQUEST_LINKS_FY);
  },

  // ── 補助ビュー: 概算要求の検索・租税特別措置・国民負担（整形は tool-shaping-secondary に委譲） ──
  searchBudgetRequests(q, ministry) {
    const data = loadBudgetRequests();
    if (!data) return { error: '2027年度の概算要求データはまだ取得されていません' };
    const { records } = filterBudgetRequests(data, { ...DEFAULT_REQUEST_FILTERS, query: q, ministry });
    return shapeBudgetRequestSearch(records, records.length, data.requestedFY, q, ministry);
  },

  searchTaxExpenditures(q, year) {
    return searchTaxExpenditures(taxExpenditureData.measures, taxExpenditureAssessments, q, year);
  },

  estimateTaxBurden(input) {
    const params = tryReadDataJson<TaxParameters>('tax-burden-params-2025.json');
    if (!params) return { error: '国民負担の計算データがありません' };
    const consumption = input.includeConsumption ? tryReadDataJson<ConsumptionDataset>('tax-burden-consumption-2024.json') : null;
    return estimateTaxBurdenWith(input, params, consumption);
  },
};
