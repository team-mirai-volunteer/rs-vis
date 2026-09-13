'use client';

/**
 * MOF予算全体ビューページ。
 *
 * 財源 → 会計 → 使途の流れを可視化する。会計間の繰入を独立した線として出し、
 * 単純合計と一次純計の差がどこで生まれるかを読めるようにしている。
 */

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMofBudgetData } from '@/client/components/mof-budget/useMofBudgetData';
import type { MOFBudgetOverviewData } from '@/types/mof-budget-overview';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { YearSelect } from '@/components/navigation/YearSelect';
import { SummaryPanel } from '@/client/components/mof-budget/SummaryPanel';
import { SpecialAccountTable } from '@/client/components/mof-budget/SpecialAccountTable';
import { SankeyChart } from '@/client/components/mof-budget/SankeyChart';
import { ViewSelect, mofBudgetViewOptions } from '@/client/components/mof-budget/ViewSelect';

export default function MOFBudgetOverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <MOFBudgetOverviewContent />
    </Suspense>
  );
}

function MOFBudgetOverviewContent() {
  const searchParams = useSearchParams();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const rawYear = searchParams.get('year');
  const buildUrl = useCallback(
    (target: number | null) => `/api/sankey/mof-overview${target ? `?year=${target}` : ''}`,
    []
  );
  const { data, year, loading, error, fetchData } = useMofBudgetData<MOFBudgetOverviewData>(
    buildUrl,
    rawYear ? Number(rawYear) : null
  );

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">読み込みに失敗しました: {error}</div>
      </div>
    );
  }

  const { metadata, summary } = data;

  return (
    <div className="min-h-screen bg-background">
      {/* ビュー・年度・ページ切替。全ページ共通で右上に置く */}
      <div className="fixed top-3 right-3 z-40 flex items-center gap-2">
        <ViewSelect value="overview" options={mofBudgetViewOptions(metadata.fiscalYear)} />
        <YearSelect
          value={String(year ?? metadata.fiscalYear)}
          onChange={y => fetchData(Number(y))}
          years={metadata.availableYears ?? [metadata.fiscalYear]}
          theme="light"
        />
        <PageNavMenu current="/mof-budget-overview" theme="light" />
      </div>

      <div className="max-w-7xl mx-auto px-8">
        {/* ヘッダー。図と地続きに見えるよう罫線と影は置かない */}
        <div className="pt-3 pb-4">
          <div className="text-xs font-medium text-mirai-text-muted">MOF予算全体・全体フロー</div>
          <h1 className="text-xl font-bold text-mirai-text">
            {metadata.fiscalYear}年度（{metadata.eraLabel}）{metadata.budgetType}
          </h1>
          <div className="mt-0.5 text-sm text-mirai-text-subtle">
            単純合計 <span className="font-semibold text-mirai-text">{formatBudgetFromYen(metadata.grossTotal)}</span>
            <span className="mx-1.5 text-mirai-text-muted">→</span>
            一次純計 <span className="font-semibold text-mirai-text">{formatBudgetFromYen(metadata.netTotal)}</span>
          </div>
        </div>

        {/* サンキー図 */}
        <div className="bg-card rounded-xl border border-mirai-border shadow-xs p-6 mb-6">
          <div
            className={isMobile ? 'overflow-x-auto' : ''}
            style={isMobile ? { WebkitOverflowScrolling: 'touch' } : {}}
          >
            <div style={{ minWidth: isMobile ? 1200 : undefined }}>
              <SankeyChart nodes={data.sankey.nodes} links={data.sankey.links} />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <SummaryPanel summary={summary} />
          <SpecialAccountTable accounts={summary.accounts} />
          <ExplanationPanel />
          <NotesPanel notes={metadata.notes} />
        </div>
      </div>
    </div>
  );
}

/** 図の読み方 */
function ExplanationPanel() {
  return (
    <div className="bg-card rounded-xl border border-mirai-border shadow-xs p-6 mb-6">
      <h2 className="text-lg font-bold text-mirai-text mb-3">図の読み方</h2>
      <ul className="space-y-2 text-sm text-mirai-text-secondary">
        <li>
          <span className="font-semibold">財源 → 会計 → 使途</span>の3段で流れを表しています。
          左端が財源、中央が会計区分、右端が使い道です。
        </li>
        <li>
          <span className="font-semibold text-destructive">赤いノードは純計で控除する分</span>です。
          会計から会計へ回すだけの金なので、単純合計では二重に数えられます。
        </li>
        <li>
          <span className="font-semibold">一般会計 → 特別会計</span>の線が、
          一般会計から特別会計へ回る繰入です。一般会計の歳出の過半がここを通ります。
        </li>
        <li>
          特別会計の財源には「他会計より受入」を含めていません。
          一般会計からの線と重複するためです。
        </li>
      </ul>
    </div>
  );
}

/** 生成物の注記 */
function NotesPanel({ notes }: { notes: string[] }) {
  return (
    <div className="bg-card rounded-xl border border-mirai-border shadow-xs p-6 mb-6">
      <h2 className="text-lg font-bold text-mirai-text mb-3">注記</h2>
      <ul className="space-y-1 text-sm text-mirai-text-subtle list-disc pl-5">
        {notes.map(note => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
