'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import SankeyBudgetDrilldown from '@/client/components/SankeyBudgetDrilldown';
import TopNSettingsPanel from '@/client/components/TopNSettingsPanel';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { useTopNSettings } from '@/client/hooks/useTopNSettings';
import type { SankeyData } from '@/types/sankey';

export default function BudgetDrilldownPage() {
  const [topN, setTopN] = useTopNSettings('budget-drilldown', 10);
  const [data, setData] = useState<SankeyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/data/budget-drilldown-top${topN}.json`);
        if (!response.ok) {
          throw new Error(`データの読み込みに失敗しました (${response.status})`);
        }
        const jsonData = await response.json();
        setData(jsonData);
      } catch (err) {
        setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
        console.error('データ読み込みエラー:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [topN]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-6">
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
          >
            ← ホームに戻る
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            📊 予算ドリルダウン
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            総予算から省庁・部局・課・係・プロジェクトへの予算配分を可視化
          </p>
        </div>

        {/* TopN設定パネル */}
        <div className="mb-6">
          <TopNSettingsPanel topN={topN} onChange={setTopN} />
        </div>

        {/* Sankey図表示エリア */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {loading && <LoadingSpinner />}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-800 dark:text-red-200">
              <p className="font-semibold">エラー</p>
              <p className="text-sm">{error}</p>
              <p className="text-xs mt-2">
                CSVデータを配置して <code>npm run generate-sankey</code> を実行してください。
              </p>
            </div>
          )}

          {!loading && !error && data && (
            <SankeyBudgetDrilldown data={data} />
          )}
        </div>

        {/* 説明 */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300">
          <p className="font-semibold mb-2">データフロー:</p>
          <p>総予算 → 省庁 (Top {topN}) → 部局 → 課 → 係 → プロジェクト</p>
        </div>
      </div>
    </div>
  );
}
