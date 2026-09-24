'use client';

/**
 * 統合ビューのサイドパネルに出す「RS事業の詳細」群。
 * /sankey-svg のサイドパネルが事業ノードに対して出している情報を、同じ共有コンポーネントで揃える:
 *   みんなの意見（ProjectComments）→ 政策評価（PolicyEvaluationBlock）→ 事業概要（ProjectOverviewSection）
 *   予算・ブロック・支出先は下部のタブに表示
 * 各 API（/api/policy-summary, /api/project-details, /api/quality-scores）は
 * RSシート年度で問い合わせる（統合ビューの year は MOF 予算年度で、RS のシート年度 = 予算年度+1）。
 * 取得結果はモジュール内キャッシュに持ち、ノードを行き来しても再取得しない。
 */

import { rsViewUrl } from '@/app/lib/rs-fiscal-year';
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QualityScoreItem } from '@/app/api/quality-scores/route';
import type { ProjectDetail } from '@/types/project-details';
import { PolicyEvaluationBlock } from '@/client/components/quality/PolicyEvaluationBlock';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { ProjectOverviewSection } from '@/client/components/subcontract/ProjectOverviewSection';
import { ProjectComments } from '@/client/components/comments/ProjectComments';
import { useCached, usePolicySummary } from './policy-summary-cache';

const detailCache = new Map<string, ProjectDetail | null>();
const extractDetail = (d: unknown) => d as ProjectDetail;

const OVERVIEW_PREVIEW_HEIGHT = 72;

export function UnifiedProjectSections({
  pid,
  projectName,
  rsSheetYear,
  fontPx,
}: {
  pid: number;
  projectName: string;
  /** RS のシート年度（API の year）。統合ビューの予算年度 + 1 */
  rsSheetYear: number;
  /** 図のラベル基準サイズ。共有コンポーネントの scaleFont に使う（11px 基準） */
  fontPx: number;
}) {
  const year = String(rsSheetYear);
  const scaleFont = useCallback((px: number) => Math.round((px * fontPx) / 11), [fontPx]);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [scoreItem, setScoreItem] = useState<QualityScoreItem | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  const policy = usePolicySummary(year);
  const detail = useCached(detailCache, `${year}-${pid}`, `/api/project-details/${pid}?year=${year}`, extractDetail);

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
  const subcontractHref = rsViewUrl(`/subcontracts/${pid}`, year);

  return (
    <div className="-mx-4 mt-3 border-t border-border">
      {/* 順番: みんなの意見 → 政策評価 → 事業概要（意見は見てもらいやすいよう最上段） */}
      <ProjectComments context={{ pid: String(pid), year, projectName, detail: detail ?? undefined }} scaleFont={scaleFont} />
      <PolicyEvaluationBlock
        pid={pid}
        year={year}
        error={policy === null ? '政策評価を取得できませんでした' : null}
        view={
          entry && policy
            ? {
                overall: entry.o,
                designClarity: entry.d,
                evidence: entry.e,
                transparency: entry.t,
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
        scaleFont={scaleFont}
        expanded={overviewExpanded}
        onToggle={() => setOverviewExpanded(v => !v)}
        previewHeight={OVERVIEW_PREVIEW_HEIGHT}
        showBottomBorder={false}
        isLoading={overviewExpanded && detail === undefined}
      />

      {scoreItem && typeof document !== 'undefined' && createPortal(<ScoreDetailDialog item={scoreItem} onClose={() => setScoreItem(null)} year={year} />, document.body)}
    </div>
  );
}
