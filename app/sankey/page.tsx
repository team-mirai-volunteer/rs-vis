'use client';

import { useEffect, useState } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import type { RS2024PresetData } from '@/types/preset';

export default function SankeyPage() {
  const [data, setData] = useState<RS2024PresetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Navigation State
  const [offset, setOffset] = useState(0);
  const [viewMode, setViewMode] = useState<'global' | 'ministry' | 'project' | 'spending'>('global');
  const [selectedMinistry, setSelectedMinistry] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);

  // Settings State
  const [topN, setTopN] = useState(3); // Global view: Number of ministries
  const [ministryTopN, setMinistryTopN] = useState(5); // Ministry view: Number of projects/spendings
  const [projectViewTopN, setProjectViewTopN] = useState(10); // Project view: Number of spendings
  const [spendingViewTopN, setSpendingViewTopN] = useState(10); // Spending view: Number of projects
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Temporary settings state for dialog
  const [tempTopN, setTempTopN] = useState(topN);
  const [tempMinistryTopN, setTempMinistryTopN] = useState(ministryTopN);
  const [tempProjectViewTopN, setTempProjectViewTopN] = useState(projectViewTopN);
  const [tempSpendingViewTopN, setTempSpendingViewTopN] = useState(spendingViewTopN);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const params = new URLSearchParams();

        if (viewMode === 'global') {
          params.set('offset', offset.toString());
          params.set('limit', topN.toString());
          params.set('projectLimit', '3'); // Fixed for global view to avoid clutter
          params.set('spendingLimit', '3');
        } else if (viewMode === 'ministry' && selectedMinistry) {
          params.set('ministryName', selectedMinistry);
          params.set('projectLimit', ministryTopN.toString());
          params.set('spendingLimit', ministryTopN.toString());
        } else if (viewMode === 'project' && selectedProject) {
          params.set('projectName', selectedProject);
          params.set('spendingLimit', projectViewTopN.toString());
        } else if (viewMode === 'spending' && selectedRecipient) {
          params.set('recipientName', selectedRecipient);
          params.set('projectLimit', spendingViewTopN.toString());
        }

        const response = await fetch(`/api/sankey?${params.toString()}`);
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
  }, [offset, topN, ministryTopN, projectViewTopN, spendingViewTopN, viewMode, selectedMinistry, selectedProject, selectedRecipient]);

  // スマホ判定
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = (node: any) => {
    const actualNode = data?.sankey.nodes.find(n => n.id === node.id);
    if (!actualNode) return;

    // Handle "Other Ministries" drill-down
    if (actualNode.id === 'ministry-budget-other') {
      setOffset(prev => prev + topN);
      return;
    }

    // Handle "Total Budget" back navigation
    if (actualNode.id === 'total-budget') {
      if (viewMode === 'ministry') {
        setViewMode('global');
        setSelectedMinistry(null);
      } else if (offset > 0) {
        setOffset(prev => Math.max(0, prev - topN));
      }
      return;
    }

    // Handle Ministry nodes
    if (actualNode.type === 'ministry-budget' && actualNode.id !== 'total-budget' && actualNode.id !== 'ministry-budget-other') {
      if (viewMode === 'ministry') {
        // In Ministry View, clicking the ministry node goes back to Global
        setViewMode('global');
        setSelectedMinistry(null);
      } else if (viewMode === 'spending') {
        // In Spending View, clicking a ministry goes to Ministry View
        setViewMode('ministry');
        setSelectedMinistry(actualNode.name);
      } else {
        // In Global/Project View, clicking a ministry goes to Ministry View
        setViewMode('ministry');
        setSelectedMinistry(actualNode.name);
      }
      return;
    }

    // Handle Project nodes
    if (actualNode.type === 'project-budget' || actualNode.type === 'project-spending') {
      if (actualNode.name === 'その他の事業') return; // Ignore "Other Projects"

      if (viewMode === 'project') {
        // In Project View, clicking the project node goes back to previous view
        if (selectedMinistry) {
          setViewMode('ministry');
          setSelectedProject(null);
        } else {
          setViewMode('global');
          setSelectedProject(null);
        }
      } else if (viewMode === 'spending') {
        // In Spending View, clicking a project goes to Project View
        setViewMode('project');
        setSelectedProject(actualNode.name);
      } else {
        // In Global/Ministry View, clicking a project goes to Project View
        setViewMode('project');
        setSelectedProject(actualNode.name);
      }
      return;
    }

    // Handle Recipient nodes
    if (actualNode.type === 'recipient') {
      if (actualNode.name === 'その他' || actualNode.name === 'その他の支出先') return; // Ignore "Other Recipients"

      if (viewMode === 'spending') {
        // In Spending View, clicking the recipient node goes back to previous view
        if (selectedProject) {
          setViewMode('project');
          setSelectedRecipient(null);
        } else if (selectedMinistry) {
          setViewMode('ministry');
          setSelectedRecipient(null);
        } else {
          setViewMode('global');
          setSelectedRecipient(null);
        }
      } else {
        // In any other view, clicking a recipient goes to Spending View
        setViewMode('spending');
        setSelectedRecipient(actualNode.name);
      }
      return;
    }
  };

  const handleReset = () => {
    setOffset(0);
    setViewMode('global');
    setSelectedMinistry(null);
    setSelectedProject(null);
    setSelectedRecipient(null);
  };

  const openSettings = () => {
    setTempTopN(topN);
    setTempMinistryTopN(ministryTopN);
    setTempProjectViewTopN(projectViewTopN);
    setTempSpendingViewTopN(spendingViewTopN);
    setIsSettingsOpen(true);
  };

  const saveSettings = () => {
    setTopN(tempTopN);
    setMinistryTopN(tempMinistryTopN);
    setProjectViewTopN(tempProjectViewTopN);
    setSpendingViewTopN(tempSpendingViewTopN);
    setIsSettingsOpen(false);
    // Reset offset if TopN changes to avoid weird states?
    // Maybe safest to reset offset to 0 if TopN changes.
    if (tempTopN !== topN) {
      setOffset(0);
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">データ読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">エラー: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

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
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              RS2024 サンキー図
              {viewMode === 'ministry' && `（${selectedMinistry}）`}
              {viewMode === 'project' && `（${selectedProject}）`}
              {viewMode === 'spending' && `（${selectedRecipient}）`}
              {viewMode === 'global' && `（Top${topN}）`}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {viewMode === 'global'
                ? '予算総計 → 府省庁（予算） → 事業（予算） → 事業（支出） → 支出先の予算・支出フロー'
                : viewMode === 'ministry'
                  ? `${selectedMinistry}の事業と支出先`
                  : viewMode === 'project'
                    ? `${selectedProject}の支出先`
                    : `${selectedRecipient}への支出元（支出先 → 事業 → 府省庁）`}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              <span className="text-green-600">■</span> 予算ベースの世界 |
              <span className="text-red-600">■</span> 支出ベースの世界
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openSettings}
              className="p-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              aria-label="設定"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            {(offset > 0 || viewMode === 'ministry') && (
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Topへ戻る
              </button>
            )}
          </div>
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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 relative">
          {loading && (
            <div className="absolute inset-0 bg-white/50 dark:bg-gray-800/50 flex items-center justify-center z-10">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

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
                onClick={handleNodeClick}
                layers={[
                  'links',
                  'nodes',
                  'legends',
                  // カスタムレイヤーで2行ラベルを実現
                  // @ts-expect-error - Nivoのカスタムレイヤー型定義が不完全なため
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ({ nodes }: any) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

                      // Clickable indication
                      const isClickable =
                        node.id === 'ministry-budget-other' ||
                        (node.id === 'total-budget' && (offset > 0 || viewMode !== 'global')) ||
                        (nodeType === 'ministry-budget' && node.id !== 'total-budget' && node.id !== 'ministry-budget-other') ||
                        ((nodeType === 'project-budget' || nodeType === 'project-spending') && !name.startsWith('その他')) ||
                        (nodeType === 'recipient' && !name.startsWith('その他'));

                      const cursorStyle = isClickable ? 'pointer' : 'default';
                      const fontWeight = isClickable ? 'bold' : 500;
                      const color = isClickable ? '#2563eb' : '#1f2937'; // Blue if clickable

                      return (
                        <g
                          key={node.id}
                          transform={`translate(${x}, ${node.y + node.height / 2})`}
                          style={{ cursor: cursorStyle }}
                          onClick={() => isClickable && handleNodeClick(node)}
                        >
                          <text
                            textAnchor={textAnchor}
                            dominantBaseline="middle"
                            style={{
                              fill: color,
                              fontSize: 12,
                              fontWeight: fontWeight,
                              pointerEvents: isClickable ? 'auto' : 'none', // Allow click only if clickable
                            }}
                          >
                            <tspan x={0} dy="-0.6em">{displayName}</tspan>
                            <tspan x={0} dy="1.2em" style={{ fontSize: 11, fontWeight: 400, fill: '#1f2937' }}>{amount}</tspan>
                          </text>
                        </g>
                      );
                    });
                  }
                ]}
                label={() => ''}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                nodeTooltip={({ node }: any) => {
                  // 元のノードデータを取得
                  const actualNode = sankey.nodes.find(n => n.id === node.id);
                  if (!actualNode) return null;

                  const name = actualNode.name;
                  const nodeType = actualNode.type || '';
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const details = actualNode.details as any;
                  const value = formatCurrency(node.value);

                  // ノードタイプに応じてタイトルを調整
                  let title = name;
                  if (nodeType === 'project-budget') {
                    title = `${name} (予算)`;
                  } else if (nodeType === 'project-spending') {
                    title = `${name} (支出)`;
                  }

                  if (node.id === 'ministry-budget-other') {
                    title += ' (クリックで詳細を表示)';
                  } else if (node.id === 'total-budget' && (offset > 0 || viewMode !== 'global')) {
                    title += ' (クリックで戻る)';
                  } else if (nodeType === 'ministry-budget' && node.id !== 'total-budget' && node.id !== 'ministry-budget-other') {
                    if (viewMode === 'ministry') {
                      title += ' (クリックで全体ビューへ戻る)';
                    } else {
                      title += ' (クリックで府省庁詳細を表示)';
                    }
                  } else if ((nodeType === 'project-budget' || nodeType === 'project-spending') && !name.startsWith('その他')) {
                    if (viewMode === 'project') {
                      title += ' (クリックで前のビューへ戻る)';
                    } else {
                      title += ' (クリックで事業詳細を表示)';
                    }
                  } else if (nodeType === 'recipient' && !name.startsWith('その他')) {
                    if (viewMode === 'spending') {
                      title += ' (クリックで前のビューへ戻る)';
                    } else {
                      title += ' (クリックで支出元を表示)';
                    }
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      {/* 設定ダイアログ */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">表示設定</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                TopN (府省庁一覧)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={tempTopN}
                onChange={(e) => setTempTopN(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 mt-1">全体ビューで表示する府省庁の数</p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                TopN (府省庁詳細)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={tempMinistryTopN}
                onChange={(e) => setTempMinistryTopN(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 mt-1">府省庁個別ビューで表示する事業・支出先の数</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                TopN (事業ビュー)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={tempProjectViewTopN}
                onChange={(e) => setTempProjectViewTopN(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 mt-1">事業個別ビューで表示する支出先の数</p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                TopN (支出ビュー)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={tempSpendingViewTopN}
                onChange={(e) => setTempSpendingViewTopN(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 mt-1">支出先個別ビューで表示する事業の数</p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                キャンセル
              </button>
              <button
                onClick={saveSettings}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
