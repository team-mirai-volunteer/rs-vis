'use client';

/**
 * 統合ビューのサイドパネルに出す「RS事業の詳細」群。
 * /sankey-svg のサイドパネルが事業ノードに対して出している情報を、同じ共有コンポーネントで揃える:
 *   政策評価（PolicyEvaluationBlock）→ 事業概要（ProjectOverviewSection）→ みんなの意見（ProjectComments）
 *   → 再委託サマリ → 予算・執行（BudgetExecutionSection）
 * 各 API（/api/policy-summary, /api/project-details, /api/subcontracts, /api/quality-scores）は
 * RSシート年度で問い合わせる（統合ビューの year は MOF 予算年度で、RS のシート年度 = 予算年度+1）。
 * 取得結果はモジュール内キャッシュに持ち、ノードを行き来しても再取得しない。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import type { PolicySummaryResponse } from '@/app/api/policy-summary/route';
import type { QualityScoreItem } from '@/app/api/quality-scores/route';
import type { ProjectDetail } from '@/types/project-details';
import type { BudgetBreakdownItem, BudgetSummary } from '@/types/sankey-svg';
import { PolicyEvaluationBlock } from '@/client/components/quality/PolicyEvaluationBlock';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { ProjectOverviewSection } from '@/client/components/subcontract/ProjectOverviewSection';
import { ProjectComments } from '@/client/components/comments/ProjectComments';
import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { TagChip } from '@/client/components/TagChip';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';

/** 再委託サマリ（/api/subcontracts の全グラフから件数だけ抜く。/sankey-svg と同じ形） */
interface SubcontractSummary {
  maxDepth: number;
  totalBlockCount: number;
  totalRecipientCount: number;
  directBlockCount: number;
  separateOriginCount: number;
  subcontractBlockCount: number;
}

const policyCache = new Map<string, PolicySummaryResponse | null>();
const detailCache = new Map<string, ProjectDetail | null>();
const subcontractCache = new Map<string, SubcontractSummary | null>();

/** キー付きの遅延取得。取得失敗・404 は null をキャッシュし再試行しない */
function useCached<T>(cache: Map<string, T | null>, key: string, url: string, extract: (data: unknown) => T | null): T | null | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    if (cache.has(key)) return;
    let cancelled = false;
    fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        cache.set(key, data == null ? null : extract(data));
      })
      .catch(() => cache.set(key, null))
      .finally(() => {
        if (!cancelled) force(v => v + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [cache, key, url, extract]);
  return cache.get(key);
}

const extractPolicy = (d: unknown) => d as PolicySummaryResponse;
const extractDetail = (d: unknown) => d as ProjectDetail;
const extractSubcontract = (data: unknown): SubcontractSummary | null => {
  const g = data as { maxDepth?: number; totalBlockCount?: number; totalRecipientCount?: number; directBlockCount?: number; separateOriginCount?: number };
  if (g?.totalBlockCount == null) return null;
  const directBlockCount = g.directBlockCount ?? 0;
  const separateOriginCount = g.separateOriginCount ?? 0;
  return {
    maxDepth: g.maxDepth ?? 0,
    totalBlockCount: g.totalBlockCount,
    totalRecipientCount: g.totalRecipientCount ?? 0,
    directBlockCount,
    separateOriginCount,
    subcontractBlockCount: Math.max(0, g.totalBlockCount - directBlockCount - separateOriginCount),
  };
};

const OVERVIEW_PREVIEW_HEIGHT = 72;
const BUDGET_LIST_HEIGHT = 260;

export function UnifiedProjectSections({
  pid,
  projectName,
  rsSheetYear,
  budgetSummary,
  budgetBreakdown,
  fontPx,
}: {
  pid: number;
  projectName: string;
  /** RS のシート年度（API の year）。統合ビューの予算年度 + 1 */
  rsSheetYear: number;
  budgetSummary?: BudgetSummary;
  budgetBreakdown?: BudgetBreakdownItem[];
  /** 図のラベル基準サイズ。共有コンポーネントの scaleFont に使う（11px 基準） */
  fontPx: number;
}) {
  const year = String(rsSheetYear);
  const scaleFont = useCallback((px: number) => Math.round((px * fontPx) / 11), [fontPx]);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [budgetExpanded, setBudgetExpanded] = useState(false);
  const [scoreItem, setScoreItem] = useState<QualityScoreItem | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  const policy = useCached(policyCache, year, `/api/policy-summary?year=${year}`, extractPolicy);
  const detail = useCached(detailCache, `${year}-${pid}`, `/api/project-details/${pid}?year=${year}`, extractDetail);
  const subcontract = useCached(subcontractCache, `${year}-${pid}`, `/api/subcontracts/${pid}?year=${year}`, extractSubcontract);

  const openScoreDialog = useCallback(() => {
    setScoreLoading(true);
    fetch(`/api/quality-scores/${pid}?year=${year}&full=1`)
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: { score?: QualityScoreItem }) => {
        if (data.score) setScoreItem(data.score);
      })
      .catch(() => {})
      .finally(() => setScoreLoading(false));
  }, [pid, year]);

  const entry = policy?.items[String(pid)];
  const subcontractHref = `/subcontracts/${pid}?year=${year}`;
  const chip: CSSProperties = { fontSize: scaleFont(10) };

  return (
    <div className="-mx-4 border-t border-border">
      <PolicyEvaluationBlock
        pid={pid}
        year={year}
        error={policy === null ? '政策評価を取得できませんでした' : null}
        view={
          entry && policy
            ? {
                overall: entry.o,
                proportionality: entry.x,
                necessity: entry.n,
                recommendation: entry.r ? policy.recommendations[entry.r] : null,
                improvementAction: entry.a ? policy.actions[entry.a] : null,
                categoryLabel: entry.c ? policy.categories[entry.c] : null,
              }
            : policy === undefined
              ? undefined
              : null
        }
        labelPx={scaleFont(11)}
        metaPx={scaleFont(10)}
        onOpenDetail={openScoreDialog}
        detailLoading={scoreLoading}
      />

      <ProjectOverviewSection
        detail={detail}
        projectName={projectName}
        year={year}
        subcontractHref={subcontractHref}
        sankeyHref={sankeySvgProjectUrl(pid, projectName, rsSheetYear)}
        scaleFont={scaleFont}
        expanded={overviewExpanded}
        onToggle={() => setOverviewExpanded(v => !v)}
        previewHeight={OVERVIEW_PREVIEW_HEIGHT}
        isLoading={overviewExpanded && detail === undefined}
      />

      <ProjectComments context={{ pid: String(pid), year, projectName, detail: detail ?? undefined }} scaleFont={scaleFont} />

      {subcontract && subcontract.totalBlockCount > 0 && (
        <div className="shrink-0 border-b border-mirai-surface-light px-4 pb-2.5 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>再委託</span>
            <a
              href={subcontractHref}
              title="再委託フローを見る"
              className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-primary hover:text-primary-accent"
              style={chip}
            >
              フロー <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[`ブロック ${subcontract.totalBlockCount}`, `支出先 ${subcontract.totalRecipientCount.toLocaleString()}`, `階層 ${subcontract.maxDepth}`].map(t => (
              <span key={t} className="whitespace-nowrap rounded-md border border-mirai-border px-1.5 text-mirai-text-subtle" style={chip}>
                {t}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <TagChip kind="direct" fontSize={scaleFont(10)}>直接 {subcontract.directBlockCount}</TagChip>
            {subcontract.subcontractBlockCount > 0 && <TagChip kind="subcontract" fontSize={scaleFont(10)}>再委託 {subcontract.subcontractBlockCount}</TagChip>}
            {subcontract.separateOriginCount > 0 && <TagChip kind="separate-origin" fontSize={scaleFont(10)}>別財源 {subcontract.separateOriginCount}</TagChip>}
          </div>
        </div>
      )}

      {budgetSummary && (
        <BudgetExecutionSection
          budgetSummary={budgetSummary}
          budgetBreakdown={budgetBreakdown ?? []}
          scaleFont={scaleFont}
          expanded={budgetExpanded}
          onToggleExpanded={() => setBudgetExpanded(v => !v)}
          listHeight={BUDGET_LIST_HEIGHT}
        />
      )}

      {scoreItem && typeof document !== 'undefined' && createPortal(<ScoreDetailDialog item={scoreItem} onClose={() => setScoreItem(null)} year={year} />, document.body)}
    </div>
  );
}
