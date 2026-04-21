'use client';

/**
 * MOF予算全体ビューページ
 *
 * 財務省予算総額（556.3兆円）とRS対象範囲（151.1兆円）を
 * 財源詳細から最終的な支出先まで可視化する
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ResponsiveSankey } from '@nivo/sankey';
import type {
  MOFBudgetOverviewData,
  MOFBudgetNodeDetails,
} from '@/types/mof-budget-overview';
import type { SankeyNode } from '@/types/sankey';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

export default function MOFBudgetOverviewPage() {
  const [data, setData] = useState<MOFBudgetOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // モバイル判定
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const response = await fetch('/api/sankey/mof-overview');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-2xl">
          <h2 className="text-red-800 text-xl font-bold mb-2">
            データ読み込みエラー
          </h2>
          <p className="text-red-700">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">データがありません</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 固定ボタン */}
      <div className="fixed top-4 right-4 z-40 flex gap-2">
        <Link
          href="/"
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-lg"
        >
          ホームに戻る
        </Link>
      </div>

      <div className="max-w-7xl mx-auto px-8">
        {/* ヘッダー */}
        <div className="mb-3 top-0 bg-gray-50 z-30 py-2 border-b border-gray-200 shadow-sm">
          <div>
            <div className="flex items-start justify-between">
              <div>
                {/* 1行目: ビュー名 */}
                <div className="text-sm font-medium text-gray-500 mb-1">
                  MOF予算全体
                </div>

                {/* 2行目: タイトル */}
                <h1 className="text-2xl font-bold text-gray-900 mb-1">
                  2023年度（令和5年度）当初予算
                </h1>

                {/* 3行目: 予算総額とRS対象 */}
                <div className="text-lg font-semibold text-gray-700">
                  予算総額{formatBudgetFromYen(data.metadata.totalBudget)} → RS対象{formatBudgetFromYen(data.metadata.rsTargetBudget)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ビュー切替ナビゲーション */}
        <div className="mb-4 bg-white rounded-lg shadow p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">詳細ビュー</h2>
          <div className="flex flex-wrap gap-2">
            <div className="px-4 py-2 bg-blue-100 text-blue-700 rounded font-medium border-2 border-blue-300">
              全体フロー（現在）
            </div>
            <Link
              href="/mof-budget-overview/transfer-detail"
              className="px-4 py-2 bg-white text-gray-700 rounded font-medium border-2 border-gray-300 hover:bg-gray-50 transition-colors"
            >
              特別会計 財源内訳
            </Link>
          </div>
        </div>

        {/* サンキー図 */}
        <div className="bg-white rounded-lg shadow-lg p-6 relative">
          <div
            className={isMobile ? 'overflow-x-auto' : ''}
            style={isMobile ? { WebkitOverflowScrolling: 'touch' } : {}}
          >
            <div style={{ height: '800px', minWidth: isMobile ? '1200px' : 'auto', backgroundColor: 'white' }}>
              <ResponsiveSankey
                data={data.sankey}
                margin={{ top: 40, right: 100, bottom: 40, left: 100 }}
                align="justify"
                sort={(a, b) => {
                  // カスタムソート: データ配列の順序を維持
                  const indexA = data.sankey.nodes.findIndex((n) => n.id === a.id);
                  const indexB = data.sankey.nodes.findIndex((n) => n.id === b.id);
                  return indexA - indexB;
                }}
                colors={getNodeColor}
              nodeOpacity={1}
              nodeHoverOthersOpacity={0.35}
              nodeThickness={42}
              nodeSpacing={20}
              nodeBorderWidth={0}
              nodeBorderRadius={3}
              linkOpacity={0.4}
              linkHoverOthersOpacity={0.1}
              linkBlendMode="multiply"
              enableLinkGradient={false}
              nodeTooltip={({ node }) => renderTooltip(node as SankeyNode & { name: string; value: number; type: string })}
              layers={[
                'links',
                'nodes',
                'legends',
                // カスタムレイヤーで金額を上に、名前を横に配置
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ({ nodes }: any) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  return nodes.map((node: any) => {
                    const actualNode = data.sankey.nodes.find((n: SankeyNode) => n.id === node.id) as SankeyNode & { name?: string; value?: number; type?: string; details?: MOFBudgetNodeDetails };
                    const name = actualNode?.name || node.id;
                    const amount = formatBudgetFromYen(node.value || 0);

                    // Position based on column: left columns on left, right columns on right
                    // Column 1-2: Revenue/Account types (left)
                    // Column 3-5: RS categories/Details/Summary (right)
                    const isLeftColumn = actualNode?.type === 'tax-detail' ||
                                        actualNode?.type === 'public-bonds' ||
                                        actualNode?.type === 'insurance-premium' ||
                                        actualNode?.type === 'other-revenue' ||
                                        actualNode?.type === 'account-type';

                    const x = isLeftColumn ? node.x - 4 : node.x + node.width + 4;
                    const textAnchor = isLeftColumn ? 'end' : 'start';

                    // X position for amount label (centered above node)
                    const amountX = node.x + node.width / 2;

                    return (
                      <g key={node.id}>
                        {/* 金額ラベル（ノードの真上中央に配置） */}
                        <text
                          x={amountX}
                          y={node.y - 6}
                          textAnchor="middle"
                          dominantBaseline="auto"
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            fill: '#1f2937',
                            pointerEvents: 'none',
                          }}
                        >
                          {amount}
                        </text>

                        {/* 名前ラベル（ノードの中央横に配置） */}
                        <text
                          x={x}
                          y={node.y + node.height / 2}
                          textAnchor={textAnchor}
                          dominantBaseline="middle"
                          style={{
                            fill: '#1f2937',
                            fontSize: 12,
                            fontWeight: 500,
                            pointerEvents: 'none',
                          }}
                        >
                          {name.includes('\n') ? (
                            name.split('\n').map((line: string, i: number) => (
                              <tspan
                                key={i}
                                x={x}
                                dy={i === 0 ? 0 : 14}
                              >
                                {line}
                              </tspan>
                            ))
                          ) : (
                            name
                          )}
                        </text>
                      </g>
                    );
                  });
                },
              ]}
            />
            </div>
          </div>
        </div>

        {/* サマリー情報 */}
        <SummaryPanel summary={data.summary} metadata={data.metadata} />

        {/* 説明パネル */}
        <ExplanationPanel />

        {/* 注記 */}
        <NotesPanel notes={data.metadata.notes} />
      </div>
    </div>
  );
}

/**
 * ノードの配色
 */
function getNodeColor(node: SankeyNode & { details?: MOFBudgetNodeDetails }): string {
  const details = node.details;

  // 税目別
  if (node.type === 'tax-detail') {
    return '#90caf9'; // 緑（持続可能な財源）
  }

  // 公債金
  if (node.type === 'public-bonds') {
    return '#70bbf8'; // 赤（将来世代の負担）
  }

  // 社会保険料
  if (node.type === 'insurance-premium') {
    return '#3b82f6'; // 青（社会保険料）
  }

  // その他収入
  if (node.type === 'other-revenue') {
    return '#f59e0b'; // オレンジ
  }

  // 一般会計
  if (details?.accountType === '一般会計') {
    return '#90caf9'; // 薄青
  }

  // 特別会計
  if (details?.accountType === '特別会計') {
    return '#f19d2f'; // 青
  }

  // RS対象
  if (details?.category === 'RS対象') {
    return '#81c784'; // 緑
  }

  // RS対象外
  if (details?.category === 'RS対象外') {
    return '#ef9a9a'; // 薄赤
  }

  // 詳細内訳（RS対象）
  if (node.type === 'budget-detail' && details?.isRSTarget) {
    return '#66bb6a'; // 緑
  }

  // 詳細内訳（RS対象外）
  if (node.type === 'budget-detail' && !details?.isRSTarget) {
    return '#e57373'; // 赤
  }

  // RS集約
  if (node.type === 'rs-summary') {
    if (node.id === 'summary-rs-target') {
      return '#4caf50'; // 濃い緑
    }
    return '#f44336'; // 濃い赤
  }

  return '#9ca3af'; // デフォルト（グレー）
}

/**
 * ツールチップ
 */
function renderTooltip(node: SankeyNode & { details?: MOFBudgetNodeDetails }) {
  const details = node.details;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 min-w-[280px] max-w-md">
      <h3 className="font-bold text-lg mb-2">{node.name}</h3>
      <p className="text-2xl font-bold text-blue-600 mb-2">
        {formatBudgetFromYen(node.value || 0)}
      </p>

      {details?.description && (
        <p className="text-sm text-gray-600 mb-2">{details.description}</p>
      )}

      {/* 税目別ノード */}
      {details?.taxType && (
        <div className="mt-2 text-sm">
          <p className="font-semibold">税目: {details.taxType}</p>
        </div>
      )}

      {/* 会計区分ノード */}
      {details?.accountType && (
        <div className="mt-2 text-sm border-t pt-2">
          <p>
            <span className="font-semibold">RS対象:</span>{' '}
            {formatBudgetFromYen(details.rsTargetAmount || 0)} (
            {details.rsTargetRate?.toFixed(1)}%)
          </p>
          <p>
            <span className="font-semibold">RS対象外:</span>{' '}
            {formatBudgetFromYen(details.rsExcludedAmount || 0)} (
            {(100 - (details.rsTargetRate || 0)).toFixed(1)}%)
          </p>
        </div>
      )}

      {/* RS対象区分ノード */}
      {details?.category && (
        <div className="mt-2 text-sm">
          <p>
            <span className="font-semibold">区分:</span> {details.category}
          </p>
          <p>
            <span className="font-semibold">親会計:</span>{' '}
            {details.parentAccount}
          </p>
        </div>
      )}

      {/* 詳細内訳ノード */}
      {details?.detailType && (
        <div className="mt-2 text-sm">
          <p>
            <span className="font-semibold">種別:</span> {details.detailType}
          </p>
          <p>
            <span className="font-semibold">RS対象:</span>{' '}
            {details.isRSTarget ? 'はい' : 'いいえ'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * サマリーパネル
 */
function SummaryPanel({
  summary,
  metadata,
}: {
  summary: MOFBudgetOverviewData['summary'];
  metadata: MOFBudgetOverviewData['metadata'];
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-bold mb-4 text-gray-800">予算サマリー</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* 全体 */}
        <div className="border-l-4 border-blue-600 pl-3">
          <div className="text-sm text-gray-600 mb-1">予算総額</div>
          <div className="text-2xl font-bold text-blue-600">
            {formatBudgetFromYen(metadata.totalBudget)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            一般会計 + 特別会計
          </div>
        </div>

        {/* RS対象 */}
        <div className="border-l-4 border-green-600 pl-3">
          <div className="text-sm text-gray-600 mb-1">RS対象</div>
          <div className="text-2xl font-bold text-green-600">
            {formatBudgetFromYen(metadata.rsTargetBudget)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {summary.overall.rsTargetRate.toFixed(1)}%
          </div>
        </div>

        {/* RS対象外 */}
        <div className="border-l-4 border-red-600 pl-3">
          <div className="text-sm text-gray-600 mb-1">RS対象外</div>
          <div className="text-2xl font-bold text-red-600">
            {formatBudgetFromYen(metadata.rsExcludedBudget)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {(100 - summary.overall.rsTargetRate).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 詳細情報 */}
      <div className="pt-4 border-t grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 一般会計 */}
        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">一般会計</h4>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-1 text-gray-600">総額</td>
                <td className="py-1 text-right font-semibold">
                  {formatBudgetFromYen(summary.generalAccount.total)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象</td>
                <td className="py-1 text-right text-green-600 font-semibold">
                  {formatBudgetFromYen(summary.generalAccount.rsTarget)} (
                  {summary.generalAccount.rsTargetRate.toFixed(1)}%)
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象外</td>
                <td className="py-1 text-right text-red-600 font-semibold">
                  {formatBudgetFromYen(summary.generalAccount.rsExcluded)} (
                  {(100 - summary.generalAccount.rsTargetRate).toFixed(1)}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 特別会計 */}
        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">特別会計</h4>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-1 text-gray-600">総額</td>
                <td className="py-1 text-right font-semibold">
                  {formatBudgetFromYen(summary.specialAccount.total)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象</td>
                <td className="py-1 text-right text-green-600 font-semibold">
                  {formatBudgetFromYen(summary.specialAccount.rsTarget)} (
                  {summary.specialAccount.rsTargetRate.toFixed(1)}%)
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象外</td>
                <td className="py-1 text-right text-red-600 font-semibold">
                  {formatBudgetFromYen(summary.specialAccount.rsExcluded)} (
                  {(100 - summary.specialAccount.rsTargetRate).toFixed(1)}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * 説明パネル
 */
function ExplanationPanel() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h2 className="text-base font-bold text-blue-900 mb-3">
        サンキー図の見方
      </h2>

      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-blue-800 mb-2 text-sm">各列の説明</h3>
          <ul className="space-y-1 text-xs text-gray-700">
            <li>
              <span className="font-semibold">Column 1:</span> 財源詳細（税目別、公債金、社会保険料等）
            </li>
            <li>
              <span className="font-semibold">Column 2:</span> 会計区分（一般会計 vs 特別会計）
            </li>
            <li>
              <span className="font-semibold">Column 3:</span> RS対象区分（事業レビュー対象 vs 対象外）
            </li>
            <li>
              <span className="font-semibold">Column 4:</span> 詳細内訳（国債費、地方交付税、年金事業等）
            </li>
            <li>
              <span className="font-semibold">Column 5:</span> RS集約（RSシステム対象 vs RS対象外）
            </li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-blue-800 mb-2 text-sm">配色の意味</h3>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-600 rounded mr-1.5"></div>
              <span>租税（持続可能な財源）</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-600 rounded mr-1.5"></div>
              <span>公債金（国債）</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-600 rounded mr-1.5"></div>
              <span>社会保険料</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded mr-1.5"></div>
              <span>RS対象</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-400 rounded mr-1.5"></div>
              <span>RS対象外</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 注記パネル
 */
function NotesPanel({ notes }: { notes: string[] }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
      <h2 className="text-base font-bold text-yellow-900 mb-3">重要な注意事項</h2>

      <ul className="space-y-2 text-xs text-gray-700">
        {notes.map((note, index) => (
          <li key={index} className="flex items-start">
            <span className="text-yellow-600 mr-1.5 text-sm">⚠️</span>
            <span>{note}</span>
          </li>
        ))}

        <li className="flex items-start mt-3 pt-3 border-t border-yellow-300">
          <span className="text-yellow-600 mr-1.5 text-sm">📊</span>
          <span>
            詳細な分析結果は{' '}
            <Link
              href="https://github.com/igomuni/marumie-rssystem/blob/main/docs/20260202_0000_MOF%E4%BA%88%E7%AE%97%E5%85%A8%E4%BD%93%E3%81%A8RS%E5%AF%BE%E8%B1%A1%E7%AF%84%E5%9B%B2%E3%81%AE%E5%8F%AF%E8%A6%96%E5%8C%96.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              こちらのドキュメント
            </Link>
            をご参照ください
          </span>
        </li>
      </ul>
    </div>
  );
}
