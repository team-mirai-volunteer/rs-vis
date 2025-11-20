'use client';

import { useEffect, useState } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import type { RS2024PresetData } from '@/types/preset';

export default function SankeyPage() {
  const [data, setData] = useState<RS2024PresetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        // キャッシュバスティングのためにタイムスタンプを追加
        const timestamp = new Date().getTime();
        const response = await fetch(`/data/rs2024-preset-top3.json?v=${timestamp}`);
        if (!response.ok) {
          throw new Error('Failed to load data');
        }
        const json: RS2024PresetData = await response.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // スマホ判定
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">データ読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">エラー: {error || 'データが見つかりません'}</p>
        </div>
      </div>
    );
  }

  const { metadata, sankey } = data;

  // 金額を兆円、億円、万円で表示（3桁カンマ区切り）
  const formatCurrency = (value: number) => {
    if (value >= 1e12) {
      const trillions = value / 1e12;
      return `${trillions.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}兆円`;
    } else if (value >= 1e8) {
      const hundreds = value / 1e8;
      return `${hundreds.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}億円`;
    } else if (value >= 1e4) {
      const tenThousands = value / 1e4;
      return `${tenThousands.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}万円`;
    } else {
      return `${value.toLocaleString('ja-JP')}円`;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            RS2024 サンキー図（Top3）
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            予算総計 → 府省庁（予算） → 事業（予算） → 事業（支出） → 支出先の予算・支出フロー（再帰的Top3選択）
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
            <span className="text-green-600">■</span> 予算ベースの世界 |
            <span className="text-red-600">■</span> 支出ベースの世界
          </p>
        </div>

        {/* 統計情報 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">カバー率</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {metadata.summary.coverageRate.toFixed(1)}%
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">選択予算額</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCurrency(metadata.summary.selectedBudget)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">府省庁/事業</p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {metadata.summary.selectedMinistries} / {metadata.summary.selectedProjects}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">支出先</p>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {metadata.summary.selectedSpendings}
            </p>
          </div>
        </div>

        {/* サンキー図 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {isMobile ? (
            <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              📱 横スクロールできます
            </div>
          ) : null}
          <div
            className={isMobile ? 'overflow-x-auto' : ''}
            style={isMobile ? { WebkitOverflowScrolling: 'touch' } : {}}
          >
            <div style={{ height: '800px', minWidth: isMobile ? '1200px' : 'auto' }}>
              <ResponsiveSankey
                data={sankey}
                margin={isMobile
                  ? { top: 40, right: 100, bottom: 40, left: 100 }
                  : { top: 40, right: 200, bottom: 40, left: 200 }
                }
                align="justify"
                sort="input"
              colors={(node) => {
                const nodeData = sankey.nodes.find(n => n.id === node.id);
                const type = nodeData?.type;
                const name = nodeData?.name || '';

                // "その他"ノードはすべてグレー
                if (name.startsWith('その他')) {
                  return '#6b7280'; // グレー系
                }

                // 予算系（緑系）、支出系（赤系）、その他（グレー）
                if (type === 'ministry-budget' || type === 'project-budget') {
                  return '#10b981'; // 緑系
                } else if (type === 'project-spending' || type === 'recipient') {
                  return '#ef4444'; // 赤系
                }
                return '#6b7280'; // グレー系
              }}
              nodeOpacity={1}
              nodeHoverOthersOpacity={0.35}
              nodeThickness={18}
              nodeSpacing={24}
              nodeBorderWidth={0}
              nodeBorderColor={{
                from: 'color',
                modifiers: [['darker', 0.8]],
              }}
              linkOpacity={0.5}
              linkHoverOthersOpacity={0.1}
              linkContract={3}
              enableLinkGradient={true}
              labelPosition="outside"
              labelOrientation="horizontal"
              labelPadding={16}
              labelTextColor="#1f2937"
              layers={[
                'links',
                'nodes',
                'legends',
                // カスタムレイヤーで2行ラベルを実現
                // @ts-ignore - Nivoのカスタムレイヤー型定義が不完全なため
                ({ nodes }) => {
                  return nodes.map((node: any) => {
                    const actualNode = sankey.nodes.find(n => n.id === node.id);
                    const name = actualNode?.name || node.id;
                    const nodeType = actualNode?.type || '';
                    const amount = formatCurrency(node.value);

                    let displayName = name;
                    if (nodeType === 'project-budget') {
                      displayName = name.length > 15 ? name.substring(0, 15) + '...' : name;
                    } else if (nodeType === 'project-spending') {
                      displayName = name.length > 15 ? name.substring(0, 15) + '...' : name;
                    } else if (name.length > 18) {
                      displayName = name.substring(0, 18) + '...';
                    }

                    // Position based on node type: budget nodes on left, spending nodes on right
                    const isBudgetNode = nodeType === 'ministry-budget' || nodeType === 'project-budget';
                    const x = isBudgetNode ? node.x - 16 : node.x + node.width + 16;
                    const textAnchor = isBudgetNode ? 'end' : 'start';

                    return (
                      <g key={node.id} transform={`translate(${x}, ${node.y + node.height / 2})`}>
                        <text
                          textAnchor={textAnchor}
                          dominantBaseline="middle"
                          style={{
                            fill: '#1f2937',
                            fontSize: 12,
                            fontWeight: 500,
                            pointerEvents: 'none',
                          }}
                        >
                          <tspan x={0} dy="-0.6em">{displayName}</tspan>
                          <tspan x={0} dy="1.2em" style={{ fontSize: 11, fontWeight: 400 }}>{amount}</tspan>
                        </text>
                      </g>
                    );
                  });
                }
              ]}
              label={() => ''}
              nodeTooltip={({ node }: any) => {
                // 元のノードデータを取得
                const actualNode = sankey.nodes.find(n => n.id === node.id);
                if (!actualNode) return null;

                const name = actualNode.name;
                const nodeType = actualNode.type || '';
                const details = actualNode.details as any;
                const value = formatCurrency(node.value);

                // ノードタイプに応じてタイトルを調整
                let title = name;
                if (nodeType === 'project-budget') {
                  title = `${name} (予算)`;
                } else if (nodeType === 'project-spending') {
                  title = `${name} (支出)`;
                }

                return (
                  <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded shadow-lg border border-gray-200 dark:border-gray-700">
                    <div className="font-bold text-gray-900 dark:text-gray-100 mb-1">
                      {title}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      金額: {value}
                    </div>
                    {details && (
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1 space-y-0.5">
                        {/* 府省庁ノード */}
                        {details.projectCount !== undefined && (
                          <div>選択事業数: {details.projectCount}</div>
                        )}
                        {details.bureauCount !== undefined && (
                          <div>局・庁数: {details.bureauCount}</div>
                        )}

                        {/* 事業（予算）・事業（支出）共通 */}
                        {details.ministry && (
                          <div>府省庁: {details.ministry}</div>
                        )}
                        {details.bureau && (
                          <div>局・庁: {details.bureau}</div>
                        )}

                        {/* 事業（予算）専用 - 詳細な予算内訳 */}
                        {details.accountCategory && (
                          <div>会計区分: {details.accountCategory}</div>
                        )}
                        {details.initialBudget !== undefined && (
                          <div>当初予算: {formatCurrency(details.initialBudget)}</div>
                        )}
                        {details.supplementaryBudget !== undefined && details.supplementaryBudget > 0 && (
                          <div>補正予算: {formatCurrency(details.supplementaryBudget)}</div>
                        )}
                        {details.carryoverBudget !== undefined && details.carryoverBudget > 0 && (
                          <div>前年度繰越: {formatCurrency(details.carryoverBudget)}</div>
                        )}
                        {details.reserveFund !== undefined && details.reserveFund > 0 && (
                          <div>予備費等: {formatCurrency(details.reserveFund)}</div>
                        )}
                        {details.totalBudget !== undefined && nodeType === 'project-budget' && (
                          <div className="font-semibold">歳出予算現額: {formatCurrency(details.totalBudget)}</div>
                        )}
                        {details.executedAmount !== undefined && nodeType === 'project-budget' && details.executedAmount > 0 && (
                          <div>執行額: {formatCurrency(details.executedAmount)}</div>
                        )}
                        {details.carryoverToNext !== undefined && details.carryoverToNext > 0 && (
                          <div>翌年度繰越: {formatCurrency(details.carryoverToNext)}</div>
                        )}

                        {/* 事業（支出）専用 */}
                        {details.executionRate !== undefined && details.executionRate > 0 && (
                          <div>執行率: {details.executionRate.toFixed(1)}%</div>
                        )}
                        {details.spendingCount !== undefined && (
                          <div>支出先数: {details.spendingCount}</div>
                        )}

                        {/* 支出先ノード */}
                        {details.corporateNumber && (
                          <div>法人番号: {details.corporateNumber}</div>
                        )}
                        {details.location && (
                          <div>所在地: {details.location}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }}
              linkTooltip={({ link }: any) => {
                return (
                  <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded shadow-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(link.source.value)} → {formatCurrency(link.target.value)}
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </div>
        </div>

        {/* フッター */}
        <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>生成日時: {new Date(metadata.generatedAt).toLocaleString('ja-JP')}</p>
          <p className="mt-2">
            データソース:{' '}
            <a
              href="https://rssystem.go.jp/download-csv/2024"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600"
            >
              行政事業レビューシステム (2024年度)
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
