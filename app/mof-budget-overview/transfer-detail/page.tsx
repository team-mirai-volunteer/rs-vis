'use client';

/**
 * 特別会計の財源内訳ビュー。
 *
 * 「その特別会計は自前の財源で回っているのか、一般会計から回ってきた金を
 * 通しているだけなのか」を会計ごとに示す。
 */

import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMofBudgetData } from '@/client/components/mof-budget/useMofBudgetData';
import type { MOFTransferDetailData } from '@/types/mof-transfer';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { AppHeader } from '@/components/navigation/AppHeader';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { YearSelect } from '@/components/navigation/YearSelect';
import { SankeyChart } from '@/client/components/mof-budget/SankeyChart';
import { ViewSelect, mofBudgetViewOptions } from '@/client/components/mof-budget/ViewSelect';

export default function TransferDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <TransferDetailContent />
    </Suspense>
  );
}

function TransferDetailContent() {
  const searchParams = useSearchParams();
  const rawYear = searchParams.get('year');
  const buildUrl = useCallback(
    (target: number | null) =>
      `/api/sankey/mof-overview?view=transfer${target ? `&year=${target}` : ''}`,
    []
  );
  const { data, year, loading, error, fetchData } = useMofBudgetData<MOFTransferDetailData>(
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

  const { metadata, funding, flows } = data;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader current="/mof-budget-overview">
        <ViewSelect value="transfer" options={mofBudgetViewOptions(metadata.fiscalYear)} />
        <YearSelect
          value={String(year ?? metadata.fiscalYear)}
          onChange={y => fetchData(Number(y))}
          years={metadata.availableYears ?? [metadata.fiscalYear]}
        />
      </AppHeader>

      <div className="max-w-7xl mx-auto px-8">
        {/* ヘッダー。図と地続きに見えるよう罫線と影は置かない */}
        <div className="pt-3 pb-4">
          <div className="text-xs font-medium text-mirai-text-muted">MOF予算全体・特別会計 財源内訳</div>
          <h1 className="text-xl font-bold text-mirai-text">
            {metadata.fiscalYear}年度（{metadata.eraLabel}）{metadata.budgetType}
          </h1>
          <div className="mt-0.5 text-sm text-mirai-text-subtle">
            他会計からの受入{' '}
            <span className="font-semibold text-mirai-text">
              {formatBudgetFromYen(metadata.receivedTotal)}
            </span>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-mirai-border shadow-xs p-6 mb-6">
          <div className="overflow-x-auto">
            <div style={{ minWidth: 900 }}>
              <SankeyChart
                nodes={data.sankey.nodes}
                links={data.sankey.links}
                height={700}
                labelMax={14}
              />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-mirai-border shadow-xs p-6 mb-6">
          <h2 className="text-lg font-bold text-mirai-text mb-3">会計別の財源</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="text-mirai-text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">特別会計</th>
                  <th className="px-2 py-2 text-right font-medium">歳入</th>
                  <th className="px-2 py-2 text-right font-medium">他会計から</th>
                  <th className="px-2 py-2 text-right font-medium">自前財源</th>
                  <th className="px-2 py-2 text-right font-medium">自前財源比率</th>
                </tr>
              </thead>
              <tbody className="text-mirai-text-secondary">
                {funding.map(f => (
                  <tr key={f.account} className="border-b border-border">
                    <td className="px-2 py-2 whitespace-nowrap">{f.account}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatBudgetFromYen(f.revenue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatBudgetFromYen(f.transferIn)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatBudgetFromYen(f.ownRevenue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {(f.ownRevenueRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-mirai-border shadow-xs p-6 mb-6">
          <h2 className="text-lg font-bold text-mirai-text mb-3">
            一般会計からの繰入（宛先別 {flows.length}件）
          </h2>
          <div className="space-y-1">
            {flows.slice(0, 15).map(flow => (
              <div
                key={flow.label}
                className="flex justify-between gap-4 text-sm text-mirai-text-secondary"
              >
                <span className="truncate">{flow.label}</span>
                <span className="tabular-nums shrink-0">
                  {formatBudgetFromYen(flow.amount)}
                </span>
              </div>
            ))}
            {flows.length > 15 && (
              <div className="text-xs text-mirai-text-muted">ほか {flows.length - 15} 件</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
