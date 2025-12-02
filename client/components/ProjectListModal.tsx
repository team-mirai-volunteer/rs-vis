'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord } from '@/types/structured';

export interface ProjectListFilters {
  ministries?: string[];
  projectName?: string;
  spendingName?: string;
  groupByProject?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (projectName: string) => void;
  onSelectMinistry?: (ministryName: string) => void;
  onSelectRecipient?: (recipientName: string) => void;
  initialFilters?: ProjectListFilters;
}

interface SpendingDetail {
  projectId: number;
  ministry: string;
  projectName: string;
  spendingName: string;
  totalBudget: number;
  totalSpendingAmount: number;
  executionRate: number;
  spendingCount?: number; // まとめる場合の支出先件数
}

type SortColumn = 'ministry' | 'projectName' | 'spendingName' | 'totalBudget' | 'totalSpendingAmount' | 'executionRate';
type SortDirection = 'asc' | 'desc';

export default function ProjectListModal({ isOpen, onClose, onSelectProject, onSelectMinistry, onSelectRecipient, initialFilters }: Props) {
  const [allData, setAllData] = useState<BudgetRecord[]>([]);
  const [spendingsData, setSpendingsData] = useState<SpendingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('totalBudget');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [projectNameFilter, setProjectNameFilter] = useState('');
  const [spendingNameFilter, setSpendingNameFilter] = useState('');
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  const [availableMinistries, setAvailableMinistries] = useState<string[]>([]);
  const [groupByProject, setGroupByProject] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  const [isFilterExpanded, setIsFilterExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768; // PC: 展開, モバイル: 折りたたみ
    }
    return true;
  });

  // データ読み込みと府省庁リスト初期化
  useEffect(() => {
    if (!isOpen) return;

    async function loadData() {
      setLoading(true);
      try {
        const response = await fetch('/data/rs2024-structured.json');
        const structuredData: RS2024StructuredData = await response.json();
        setAllData(structuredData.budgets);
        setSpendingsData(structuredData.spendings);

        // 府省庁別の予算総額を計算
        const ministryBudgets = new Map<string, number>();
        structuredData.budgets.forEach(b => {
          const current = ministryBudgets.get(b.ministry) || 0;
          ministryBudgets.set(b.ministry, current + b.totalBudget);
        });

        // 府省庁リスト作成（予算額の降順）
        const ministries = Array.from(ministryBudgets.entries())
          .sort((a, b) => b[1] - a[1]) // 予算額の降順
          .map(([name]) => name);

        setAvailableMinistries(ministries);

        // Apply initial filters
        if (initialFilters) {
          if (initialFilters.ministries) {
            setSelectedMinistries(initialFilters.ministries);
          } else {
            setSelectedMinistries(ministries); // Default to all if not specified
          }

          if (initialFilters.projectName !== undefined) {
            setProjectNameFilter(initialFilters.projectName);
          } else {
            setProjectNameFilter('');
          }

          if (initialFilters.spendingName !== undefined) {
            setSpendingNameFilter(initialFilters.spendingName);
          } else {
            setSpendingNameFilter('');
          }

          if (initialFilters.groupByProject !== undefined) {
            setGroupByProject(initialFilters.groupByProject);
          }
          // If groupByProject is not specified, keep current state (or default)
        } else {
          // No initial filters, reset to defaults
          setSelectedMinistries(ministries);
          setProjectNameFilter('');
          setSpendingNameFilter('');
          // Keep groupByProject as is or reset? Usually reset is safer for "fresh open"
          // But user requirement says "Keep previous" for some cases.
          // The parent component will pass undefined if it wants to keep previous, 
          // but here we are mounting/opening. 
          // If the modal is kept mounted but hidden, state persists.
          // If unmounted, state resets.
          // This component seems to be conditionally rendered or just hidden?
          // In page.tsx: <ProjectListModal isOpen={isProjectListOpen} ... />
          // It is always rendered but isOpen controls visibility (return null if !isOpen).
          // So state is lost when closed.
          // So "Keep previous" implies we need to pass the *previous* state back in, 
          // OR we need to change how this component works (don't return null).
          // Let's check line 287: if (!isOpen) return null;
          // Yes, state is lost.
          // To support "Keep previous", the parent needs to manage the state or we need to not unmount.
          // However, the user requirement says "Keep previous setting" for "groupByProject" in some cases.
          // Since we are re-implementing the opening logic, we can pass the desired state from parent.
          // But wait, if the parent doesn't know the *user's last choice* inside the modal, it can't pass it back.
          // We might need to lift the state up or change `if (!isOpen) return null` to `style={{display: isOpen ? 'block' : 'none'}}`.
          // Changing to display:none is easier to preserve state.
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [isOpen, initialFilters]);

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 府省庁トグル
  const toggleMinistry = (ministry: string) => {
    setSelectedMinistries((prev) =>
      prev.includes(ministry) ? prev.filter((m) => m !== ministry) : [...prev, ministry]
    );
  };

  // 全選択/全解除
  const toggleAllMinistries = () => {
    if (selectedMinistries.length === availableMinistries.length) {
      setSelectedMinistries([]);
    } else {
      setSelectedMinistries(availableMinistries);
    }
  };

  // ドロップダウン表示テキスト
  const getDropdownDisplayText = () => {
    if (selectedMinistries.length === 0) return '表示対象なし';
    if (selectedMinistries.length === 1) return selectedMinistries[0];
    return `選択中 (${selectedMinistries.length}/${availableMinistries.length})`;
  };

  // フィルタリング、支出先展開、ソート
  const sortedData = useMemo(() => {
    // 府省庁でフィルタ
    const filteredByMinistry = allData.filter((item) => selectedMinistries.includes(item.ministry));

    // 支出先をまとめるかどうかで処理を分岐
    let details: SpendingDetail[] = [];

    if (groupByProject) {
      // まとめる場合：事業ごとに1行
      details = filteredByMinistry.map(item => ({
        projectId: item.projectId,
        ministry: item.ministry,
        projectName: item.projectName,
        spendingName: '', // まとめる場合は空
        totalBudget: item.totalBudget,
        totalSpendingAmount: item.totalSpendingAmount,
        executionRate: item.executionRate,
        spendingCount: item.spendingIds.length,
      }));
    } else {
      // 展開する場合：支出先ごとに1行
      // SpendingRecordから実際の支出先データを取得して展開
      const spendingMap = new Map<number, SpendingRecord>();
      spendingsData.forEach(s => spendingMap.set(s.spendingId, s));

      filteredByMinistry.forEach(budget => {
        budget.spendingIds.forEach(spendingId => {
          const spending = spendingMap.get(spendingId);
          if (!spending) return;

          // この支出先がこの事業からいくら受け取っているかを計算
          const projectSpending = spending.projects.find(p => p.projectId === budget.projectId);
          const spendingAmount = projectSpending?.amount || 0;

          details.push({
            projectId: budget.projectId,
            ministry: budget.ministry,
            projectName: budget.projectName,
            spendingName: spending.spendingName,
            totalBudget: budget.totalBudget,
            totalSpendingAmount: spendingAmount, // この事業からこの支出先への支出額
            executionRate: budget.totalBudget > 0 ? (spendingAmount / budget.totalBudget) * 100 : 0,
          });
        });
      });
    }

    // テキストフィルタ
    details = details.filter((item) => {
      const matchProject = projectNameFilter === '' || item.projectName.toLowerCase().includes(projectNameFilter.toLowerCase());
      const matchSpending = groupByProject || spendingNameFilter === '' || item.spendingName.toLowerCase().includes(spendingNameFilter.toLowerCase());
      return matchProject && matchSpending;
    });

    // ソート
    const sorted = [...details].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case 'ministry':
          aValue = a.ministry;
          bValue = b.ministry;
          break;
        case 'projectName':
          aValue = a.projectName;
          bValue = b.projectName;
          break;
        case 'spendingName':
          aValue = a.spendingName;
          bValue = b.spendingName;
          break;
        case 'totalBudget':
          aValue = a.totalBudget;
          bValue = b.totalBudget;
          break;
        case 'totalSpendingAmount':
          aValue = a.totalSpendingAmount;
          bValue = b.totalSpendingAmount;
          break;
        case 'executionRate':
          aValue = a.executionRate;
          bValue = b.executionRate;
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue, 'ja')
          : bValue.localeCompare(aValue, 'ja');
      }

      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return sorted;
  }, [allData, spendingsData, selectedMinistries, groupByProject, sortColumn, sortDirection, projectNameFilter, spendingNameFilter]);

  // ページネーション
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);

  // フィルタ変更時にページを1にリセット
  useEffect(() => {
    setCurrentPage(1);
  }, [projectNameFilter, spendingNameFilter, selectedMinistries, groupByProject, sortColumn, sortDirection]);

  // ソートハンドラー
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // ソートインジケーター
  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return '⇅';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  // 金額フォーマット
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

  // セルクリックハンドラー
  const handleMinistryClick = (ministryName: string) => {
    if (onSelectMinistry) {
      onSelectMinistry(ministryName);
      onClose();
    }
  };

  const handleProjectClick = (projectName: string) => {
    onSelectProject(projectName);
    onClose();
  };

  const handleRecipientClick = (recipientName: string) => {
    if (onSelectRecipient) {
      onSelectRecipient(recipientName);
      onClose();
    }
  };

  // if (!isOpen) return null; // Stateを維持するためにアンマウントしない

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 transition-opacity duration-200 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
        {/* ヘッダー */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start mb-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">事業一覧</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
            >
              ✕
            </button>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            全{allData.length.toLocaleString()}事業
            {sortedData.length !== allData.length && ` （フィルター後: ${sortedData.length.toLocaleString()}件）`}
          </div>
        </div>

        {/* フィルタ */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          {/* 折り畳みヘッダー */}
          <button
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="font-medium text-gray-900 dark:text-white">フィルタ設定</span>
            <span className="text-gray-500 dark:text-gray-400 text-lg">
              {isFilterExpanded ? '▼' : '▶'}
            </span>
          </button>

          {/* フィルタコンテンツ */}
          {isFilterExpanded && (
            <div className="px-4 pb-4">
              <div className="flex flex-col gap-3">
                {/* 1行目: 府省庁フィルタと支出先まとめチェックボックス */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* 府省庁フィルタ（カスタムドロップダウン） */}
                  <div className="w-64 relative" ref={dropdownRef}>
                    <label className="block text-xs font-medium mb-1 text-gray-700 dark:text-gray-300">府省庁</label>
                    <button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full px-3 py-2 text-sm text-left border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between"
                    >
                      <span className="truncate">{getDropdownDisplayText()}</span>
                      <span className="ml-2 text-gray-400 text-lg">▾</span>
                    </button>

                    {isDropdownOpen && (
                      <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg max-h-64 overflow-y-auto">
                        {/* 全選択/全解除 */}
                        <label className="flex items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer border-b border-gray-200 dark:border-gray-600">
                          <input
                            type="checkbox"
                            checked={selectedMinistries.length === availableMinistries.length}
                            onChange={toggleAllMinistries}
                            className="mr-2"
                          />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">すべて選択/解除</span>
                        </label>

                        {/* 府省庁リスト */}
                        {availableMinistries.map((ministry) => (
                          <label
                            key={ministry}
                            className="flex items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedMinistries.includes(ministry)}
                              onChange={() => toggleMinistry(ministry)}
                              className="mr-2"
                            />
                            <span className="text-sm text-gray-900 dark:text-white">{ministry}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 支出先まとめチェックボックス */}
                  <div className="flex items-center gap-2 mt-5">
                    <input
                      type="checkbox"
                      id="groupByProject"
                      checked={groupByProject}
                      onChange={(e) => setGroupByProject(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <label htmlFor="groupByProject" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                      支出先をまとめる
                    </label>
                  </div>
                </div>

                {/* 2行目: テキスト検索 */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* 事業名フィルタ */}
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium mb-1 text-gray-700 dark:text-gray-300">事業名</label>
                    <input
                      type="text"
                      value={projectNameFilter}
                      onChange={(e) => setProjectNameFilter(e.target.value)}
                      placeholder="事業名で検索"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* 支出先フィルタ */}
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium mb-1 text-gray-700 dark:text-gray-300">支出先</label>
                    <input
                      type="text"
                      value={spendingNameFilter}
                      onChange={(e) => setSpendingNameFilter(e.target.value)}
                      placeholder="支出先で検索"
                      disabled={groupByProject}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* データテーブル */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-600 dark:text-gray-400">
              読み込み中...
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-[5] shadow-sm">
                <tr className="border-b-2 border-gray-300 dark:border-gray-600">
                  <th
                    className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 whitespace-nowrap"
                    onClick={() => handleSort('ministry')}
                  >
                    府省庁 {getSortIndicator('ministry')}
                  </th>
                  <th
                    className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 min-w-[300px]"
                    onClick={() => handleSort('projectName')}
                  >
                    事業名 {getSortIndicator('projectName')}
                  </th>
                  <th
                    className={`px-4 py-2 text-left ${groupByProject ? 'whitespace-nowrap w-28' : 'min-w-[250px]'
                      } ${groupByProject ? 'cursor-default' : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                    onClick={() => !groupByProject && handleSort('spendingName')}
                  >
                    {groupByProject ? '支出先件数' : `支出先 ${getSortIndicator('spendingName')}`}
                  </th>
                  <th
                    className="px-4 py-2 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 whitespace-nowrap"
                    onClick={() => handleSort('totalBudget')}
                  >
                    予算 {getSortIndicator('totalBudget')}
                  </th>
                  <th
                    className="px-4 py-2 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 whitespace-nowrap"
                    onClick={() => handleSort('totalSpendingAmount')}
                  >
                    支出 {getSortIndicator('totalSpendingAmount')}
                  </th>
                  <th
                    className="px-4 py-2 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 whitespace-nowrap"
                    onClick={() => handleSort('executionRate')}
                  >
                    執行率 {getSortIndicator('executionRate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((item, idx) => (
                  <tr
                    key={`${item.projectId}-${idx}`}
                    className="border-t border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                  >
                    <td
                      className="px-4 py-2 whitespace-nowrap text-gray-900 dark:text-white cursor-pointer hover:underline"
                      onClick={() => handleMinistryClick(item.ministry)}
                    >
                      {item.ministry}
                    </td>
                    <td
                      className="px-4 py-2 text-gray-900 dark:text-white cursor-pointer hover:underline"
                      onClick={() => handleProjectClick(item.projectName)}
                    >
                      {item.projectName}
                    </td>
                    <td
                      className={`px-4 py-2 text-gray-900 dark:text-white ${!groupByProject && item.spendingName ? 'cursor-pointer hover:underline' : ''}`}
                      onClick={() => !groupByProject && item.spendingName && handleRecipientClick(item.spendingName)}
                    >
                      {groupByProject ? (item.spendingCount || 0).toLocaleString() : item.spendingName}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap text-gray-900 dark:text-white">
                      {formatCurrency(item.totalBudget)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap text-gray-900 dark:text-white">
                      {formatCurrency(item.totalSpendingAmount)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap text-gray-900 dark:text-white">
                      {item.executionRate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ページネーション */}
        {!loading && totalPages > 1 && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {((currentPage - 1) * itemsPerPage + 1).toLocaleString()}-
                {Math.min(currentPage * itemsPerPage, sortedData.length).toLocaleString()} /
                {sortedData.length.toLocaleString()}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="w-8 h-8 flex items-center justify-center text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white"
                >
                  «
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-8 h-8 flex items-center justify-center text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white"
                >
                  ‹
                </button>
                <span className="text-xs text-gray-700 dark:text-gray-300 px-2">
                  {currentPage}/{totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="w-8 h-8 flex items-center justify-center text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white"
                >
                  ›
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="w-8 h-8 flex items-center justify-center text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white"
                >
                  »
                </button>
              </div>
            </div>
          </div>
        )}

        {/* フッター */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
