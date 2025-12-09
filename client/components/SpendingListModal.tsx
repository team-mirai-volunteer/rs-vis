'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord } from '@/types/structured';

export interface SpendingListFilters {
  ministries?: string[];
  projectName?: string;
  spendingName?: string;
  groupBySpending?: boolean; // 事業名でまとめる
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectRecipient: (recipientName: string) => void;
  onSelectMinistry?: (ministryName: string) => void;
  onSelectProject?: (projectName: string) => void;
  initialFilters?: SpendingListFilters;
}

interface SpendingDetail {
  spendingName: string;
  projectName: string;
  ministry: string;
  totalBudget: number;
  totalSpendingAmount: number;
  executionRate: number;
  projectCount?: number; // まとめる場合の事業件数
  ministryBreakdown?: MinistryBreakdown[]; // まとめる場合の府省庁別内訳
}

type SortColumn = 'spendingName' | 'projectName' | 'ministry' | 'totalBudget' | 'totalSpendingAmount' | 'executionRate' | 'projectCount';
type SortDirection = 'asc' | 'desc';
type SearchMode = 'contains' | 'exact' | 'prefix';

interface MinistryBreakdown {
  ministry: string;
  amount: number;
}

export default function SpendingListModal({ isOpen, onClose, onSelectRecipient, onSelectMinistry, onSelectProject, initialFilters }: Props) {
  const [allData, setAllData] = useState<BudgetRecord[]>([]);
  const [spendingsData, setSpendingsData] = useState<SpendingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('totalSpendingAmount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [spendingNameFilter, setSpendingNameFilter] = useState('');
  const [projectNameFilter, setProjectNameFilter] = useState('');
  const [spendingNameSearchMode, setSpendingNameSearchMode] = useState<SearchMode>('contains');
  const [projectNameSearchMode, setProjectNameSearchMode] = useState<SearchMode>('contains');
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  const [availableMinistries, setAvailableMinistries] = useState<string[]>([]);
  const [groupBySpending, setGroupBySpending] = useState(true); // 事業名でまとめる
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  const [isFilterExpanded, setIsFilterExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });
  // 金額範囲フィルタ（千円単位）
  const [budgetMin, setBudgetMin] = useState<string>('');
  const [budgetMax, setBudgetMax] = useState<string>('');
  const [spendingMin, setSpendingMin] = useState<string>('');
  const [spendingMax, setSpendingMax] = useState<string>('');
  const [ministryBreakdownModal, setMinistryBreakdownModal] = useState<{
    isOpen: boolean;
    spendingName: string;
    ministries: MinistryBreakdown[];
  }>({
    isOpen: false,
    spendingName: '',
    ministries: [],
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
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name);

        setAvailableMinistries(ministries);

        // Apply initial filters
        if (initialFilters) {
          if (initialFilters.ministries) {
            setSelectedMinistries(initialFilters.ministries);
          } else {
            setSelectedMinistries(ministries);
          }

          if (initialFilters.spendingName !== undefined) {
            setSpendingNameFilter(initialFilters.spendingName);
          } else {
            setSpendingNameFilter('');
          }

          if (initialFilters.projectName !== undefined) {
            setProjectNameFilter(initialFilters.projectName);
          } else {
            setProjectNameFilter('');
          }

          if (initialFilters.groupBySpending !== undefined) {
            setGroupBySpending(initialFilters.groupBySpending);
          }
        } else {
          setSelectedMinistries(ministries);
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [isOpen, initialFilters]);

  // 金額入力をパース（日本語単位対応）
  const parseAmountInput = (input: string): number | null => {
    if (!input) return null;

    // カンマを除去してからトリム
    const trimmed = input.trim().replace(/,/g, '');

    // 単位付き入力をパース（優先）
    const match = trimmed.match(/^([\d.]+)\s*(兆|億|万|千)?円?$/);

    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2];

    if (isNaN(value)) return null;

    // 1円単位に変換（データは1円単位で格納されている）
    switch (unit) {
      case '兆': return value * 1000000000000; // 兆円 → 円
      case '億': return value * 100000000;     // 億円 → 円
      case '万': return value * 10000;         // 万円 → 円
      case '千': return value * 1000;          // 千円 → 円
      default: return value;                   // 単位なし = 1円単位
    }
  };

  // フィルタリング＆集計ロジック
  const processedData = useMemo(() => {
    const result: SpendingDetail[] = [];
    const spendingMap = new Map<number, SpendingRecord>();

    // SpendingRecordをMapに格納
    spendingsData.forEach(s => {
      spendingMap.set(s.spendingId, s);
    });

    // フィルタリング対象の事業を取得
    // フィルタリング関数
    const checkMatch = (text: string, filter: string, mode: SearchMode) => {
      if (!filter) return true;
      const t = text.toLowerCase();
      const f = filter.toLowerCase();
      switch (mode) {
        case 'exact': return t === f;
        case 'prefix': return t.startsWith(f);
        case 'contains': default: return t.includes(f);
      }
    };

    const filteredProjects = allData.filter((project) => {
      // 府省庁フィルタ
      if (!selectedMinistries.includes(project.ministry)) return false;

      // 事業名フィルタ
      if (projectNameFilter && !checkMatch(project.projectName, projectNameFilter, projectNameSearchMode)) {
        return false;
      }

      return true;
    });

    // 支出先ごとにデータを作成
    filteredProjects.forEach(project => {
      project.spendingIds.forEach(spendingId => {
        const spending = spendingMap.get(spendingId);
        if (!spending) return;

        // 支出先名フィルタ
        if (spendingNameFilter && !checkMatch(spending.spendingName, spendingNameFilter, spendingNameSearchMode)) {
          return;
        }

        // この事業からの支出額を取得
        const projectSpending = spending.projects.find(p => p.projectId === project.projectId);
        if (!projectSpending) return;

        result.push({
          spendingName: spending.spendingName,
          projectName: project.projectName,
          ministry: project.ministry,
          totalBudget: project.totalBudget,
          totalSpendingAmount: projectSpending.amount,
          executionRate: project.executionRate,
        });
      });
    });

    // 事業名でまとめる場合
    if (groupBySpending) {
      const grouped = new Map<string, SpendingDetail & { ministryAmounts: Map<string, number> }>();

      result.forEach(item => {
        const key = item.spendingName;
        const existing = grouped.get(key);

        if (existing) {
          existing.totalBudget += item.totalBudget;
          existing.totalSpendingAmount += item.totalSpendingAmount;
          existing.projectCount = (existing.projectCount || 1) + 1;
          // 府省庁ごとの支出額を記録
          const currentAmount = existing.ministryAmounts.get(item.ministry) || 0;
          existing.ministryAmounts.set(item.ministry, currentAmount + item.totalSpendingAmount);
          // 執行率は加重平均で再計算
          existing.executionRate = existing.totalBudget > 0
            ? (existing.totalSpendingAmount / existing.totalBudget) * 100
            : 0;
        } else {
          const ministryAmounts = new Map<string, number>();
          ministryAmounts.set(item.ministry, item.totalSpendingAmount);
          grouped.set(key, {
            ...item,
            projectCount: 1,
            ministryAmounts,
          });
        }
      });

      // 最も割合が大きい府省庁を計算して表示文字列を作成
      return Array.from(grouped.values()).map(item => {
        const sortedMinistries = Array.from(item.ministryAmounts.entries())
          .sort((a, b) => b[1] - a[1]);

        const topMinistry = sortedMinistries[0]?.[0] || '';
        const otherCount = sortedMinistries.length - 1;

        const ministryDisplay = otherCount > 0
          ? `${topMinistry} 他${otherCount}件`
          : topMinistry;

        // 府省庁別内訳データを作成
        const ministryBreakdown: MinistryBreakdown[] = sortedMinistries.map(([ministry, amount]) => ({
          ministry,
          amount,
        }));

        return {
          spendingName: item.spendingName,
          projectName: item.projectName,
          ministry: ministryDisplay,
          totalBudget: item.totalBudget,
          totalSpendingAmount: item.totalSpendingAmount,
          executionRate: item.executionRate,
          projectCount: item.projectCount,
          ministryBreakdown,
        };
      });
    }

    return result;
  }, [allData, spendingsData, selectedMinistries, projectNameFilter, spendingNameFilter, groupBySpending, projectNameSearchMode, spendingNameSearchMode]);

  // 金額範囲フィルタ
  const amountFilteredData = useMemo(() => {
    const budgetMinVal = parseAmountInput(budgetMin) ?? -Infinity;
    const budgetMaxVal = parseAmountInput(budgetMax) ?? Infinity;
    const spendingMinVal = parseAmountInput(spendingMin) ?? -Infinity;
    const spendingMaxVal = parseAmountInput(spendingMax) ?? Infinity;

    return processedData.filter(item => {
      const matchBudget = item.totalBudget >= budgetMinVal && item.totalBudget <= budgetMaxVal;
      const matchSpending = item.totalSpendingAmount >= spendingMinVal && item.totalSpendingAmount <= spendingMaxVal;
      return matchBudget && matchSpending;
    });
  }, [processedData, budgetMin, budgetMax, spendingMin, spendingMax]);

  // ソート
  const sortedData = useMemo(() => {
    return [...amountFilteredData].sort((a, b) => {
      // projectNameでソートする場合、groupBySpendingがOnならprojectCountでソート
      let column = sortColumn;
      if (sortColumn === 'projectName' && groupBySpending) {
        const aCount = a.projectCount || 0;
        const bCount = b.projectCount || 0;
        return sortDirection === 'asc' ? aCount - bCount : bCount - aCount;
      }

      if (sortColumn === 'projectCount') {
        const aCount = a.projectCount || 0;
        const bCount = b.projectCount || 0;
        return sortDirection === 'asc' ? aCount - bCount : bCount - aCount;
      }

      let aVal: string | number | undefined = a[column];
      let bVal: string | number | undefined = b[column];

      if (aVal === undefined) aVal = 0;
      if (bVal === undefined) bVal = 0;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal, 'ja')
          : bVal.localeCompare(aVal, 'ja');
      }

      // Ensure both are numbers for subtraction
      const aNum = typeof aVal === 'number' ? aVal : 0;
      const bNum = typeof bVal === 'number' ? bVal : 0;

      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    });
  }, [amountFilteredData, sortColumn, sortDirection, groupBySpending]);

  // ページネーション
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);

  // ソート変更ハンドラ
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // フィルタ変更時にページを1にリセット
  useEffect(() => {
    setCurrentPage(1);
  }, [spendingNameFilter, projectNameFilter, selectedMinistries, groupBySpending, sortColumn, sortDirection, budgetMin, budgetMax, spendingMin, spendingMax]);

  // ドロップダウン外クリック検知
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ページ変更時にトップにスクロール
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMinistries, projectNameFilter, spendingNameFilter, groupBySpending]);

  // 全支出先数の計算
  const totalSpendingCount = useMemo(() => {
    return spendingsData.length;
  }, [spendingsData]);

  const formatCurrency = (value: number) => {
    if (value >= 1e12) {
      return `${(value / 1e12).toFixed(2)}兆円`;
    } else if (value >= 1e8) {
      return `${(value / 1e8).toFixed(2)}億円`;
    } else if (value >= 1e4) {
      return `${(value / 1e4).toFixed(2)}万円`;
    }
    return `${value.toLocaleString()}円`;
  };

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return '⇅';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const getDropdownDisplayText = () => {
    if (selectedMinistries.length === 0) {
      return '表示対象なし';
    } else if (selectedMinistries.length === 1) {
      return selectedMinistries[0];
    } else {
      return `選択中 (${selectedMinistries.length}/${availableMinistries.length})`;
    }
  };

  const toggleAllMinistries = () => {
    if (selectedMinistries.length === availableMinistries.length) {
      setSelectedMinistries([]);
    } else {
      setSelectedMinistries(availableMinistries);
    }
  };

  const toggleMinistry = (ministry: string) => {
    if (selectedMinistries.includes(ministry)) {
      setSelectedMinistries(selectedMinistries.filter((m) => m !== ministry));
    } else {
      setSelectedMinistries([...selectedMinistries, ministry]);
    }
  };

  const handleMinistryClick = (item: SpendingDetail) => {
    if (groupBySpending && item.ministryBreakdown && item.ministryBreakdown.length > 1) {
      // 複数府省庁がある場合はモーダルを表示
      setMinistryBreakdownModal({
        isOpen: true,
        spendingName: item.spendingName,
        ministries: item.ministryBreakdown,
      });
    } else if (onSelectMinistry) {
      // 単一府省庁の場合は直接遷移
      const ministry = item.ministryBreakdown?.[0]?.ministry || item.ministry;
      onSelectMinistry(ministry);
      onClose();
    }
  };

  const handleMinistryBreakdownSelect = (ministry: string) => {
    setMinistryBreakdownModal({ isOpen: false, spendingName: '', ministries: [] });
    if (onSelectMinistry) {
      onSelectMinistry(ministry);
      onClose();
    }
  };

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 transition-opacity duration-200 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
        {/* ヘッダー */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start mb-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">支出先一覧</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
            >
              ✕
            </button>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            全{totalSpendingCount.toLocaleString()}支出先
            {sortedData.length !== totalSpendingCount && ` （フィルター後: ${sortedData.length.toLocaleString()}件）`}
            <br />
            {(() => {
              // 事業名まとめOFF時は同じ事業が複数行になる可能性があるため、予算は重複カウントしない
              // まとめON時は支出先ごとに集計済みだが、同じ事業が複数の支出先に出ている場合は重複する
              // 正確な合計を出すため、元データ(allData)から関連事業を特定して集計
              const relatedProjectIds = new Set<number>();

              // sortedDataに含まれる事業を特定
              if (groupBySpending) {
                // まとめON: processedDataの生成過程を追う必要があるが、
                // sortedDataからは元の事業IDが取れないため、
                // 表示されている支出先名から逆引きする
                const displayedSpendingNames = new Set(sortedData.map(item => item.spendingName));
                spendingsData.forEach(spending => {
                  if (displayedSpendingNames.has(spending.spendingName)) {
                    spending.projects.forEach(p => relatedProjectIds.add(p.projectId));
                  }
                });
              } else {
                // まとめOFF: sortedDataの各行がそのまま事業を表す
                sortedData.forEach(item => {
                  // projectNameから事業を特定
                  const project = allData.find(p =>
                    p.projectName === item.projectName && p.ministry === item.ministry
                  );
                  if (project) relatedProjectIds.add(project.projectId);
                });
              }

              // 関連事業の予算合計
              let totalBudget = 0;
              relatedProjectIds.forEach(projectId => {
                const project = allData.find(p => p.projectId === projectId);
                if (project) totalBudget += project.totalBudget;
              });

              // 支出合計は単純に合計（まとめON/OFFで既に正しく集計されている）
              const totalSpending = sortedData.reduce((sum, item) => sum + item.totalSpendingAmount, 0);

              return `予算: ${formatCurrency(totalBudget)} / 支出: ${formatCurrency(totalSpending)}`;
            })()}
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
                {/* 1行目: 府省庁フィルタと事業名まとめチェックボックス */}
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

                  {/* 事業名まとめチェックボックス */}
                  <div className="flex items-center gap-2 mt-5">
                    <input
                      type="checkbox"
                      id="groupBySpending"
                      checked={groupBySpending}
                      onChange={(e) => setGroupBySpending(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <label htmlFor="groupBySpending" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                      事業名をまとめる
                    </label>
                  </div>
                </div>

                {/* 2行目: テキスト検索（検索モード付き） */}
                <div className="flex items-center gap-3 flex-wrap w-full">
                  {/* 支出先フィルタ */}
                  <div className="flex-1 min-w-[250px]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-700 dark:text-gray-300">支出先</label>
                      <select
                        value={spendingNameSearchMode}
                        onChange={(e) => setSpendingNameSearchMode(e.target.value as SearchMode)}
                        className="text-xs border-none bg-transparent text-gray-500 focus:ring-0 cursor-pointer hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      >
                        <option value="contains">含む</option>
                        <option value="exact">完全一致</option>
                        <option value="prefix">前方一致</option>
                      </select>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={spendingNameFilter}
                        onChange={(e) => setSpendingNameFilter(e.target.value)}
                        placeholder="支出先で検索"
                        className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {spendingNameFilter && (
                        <button
                          onClick={() => setSpendingNameFilter('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 事業名フィルタ */}
                  <div className="flex-1 min-w-[250px]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-700 dark:text-gray-300">事業名</label>
                      <select
                        value={projectNameSearchMode}
                        onChange={(e) => setProjectNameSearchMode(e.target.value as SearchMode)}
                        disabled={groupBySpending}
                        className="text-xs border-none bg-transparent text-gray-500 focus:ring-0 cursor-pointer hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="contains">含む</option>
                        <option value="exact">完全一致</option>
                        <option value="prefix">前方一致</option>
                      </select>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={projectNameFilter}
                        onChange={(e) => setProjectNameFilter(e.target.value)}
                        placeholder="事業名で検索"
                        disabled={groupBySpending}
                        className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      {projectNameFilter && !groupBySpending && (
                        <button
                          onClick={() => setProjectNameFilter('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3行目: 金額範囲フィルタ */}
                <div className="flex items-start gap-3 flex-wrap">
                  {/* 予算範囲 */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">予算範囲</label>
                    <input
                      type="text"
                      value={budgetMin}
                      onChange={(e) => setBudgetMin(e.target.value)}
                      placeholder="下限 (例: 1000億円)"
                      className="w-36 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500 dark:text-gray-400">〜</span>
                    <input
                      type="text"
                      value={budgetMax}
                      onChange={(e) => setBudgetMax(e.target.value)}
                      placeholder="上限 (例: 5000億円)"
                      className="w-36 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {(budgetMin || budgetMax) && (
                      <button
                        onClick={() => { setBudgetMin(''); setBudgetMax(''); }}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* 支出範囲 */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">支出範囲</label>
                    <input
                      type="text"
                      value={spendingMin}
                      onChange={(e) => setSpendingMin(e.target.value)}
                      placeholder="下限 (例: 100億円)"
                      className="w-36 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500 dark:text-gray-400">〜</span>
                    <input
                      type="text"
                      value={spendingMax}
                      onChange={(e) => setSpendingMax(e.target.value)}
                      placeholder="上限 (例: 500億円)"
                      className="w-36 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {(spendingMin || spendingMax) && (
                      <button
                        onClick={() => { setSpendingMin(''); setSpendingMax(''); }}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* テーブル */}
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
                    className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 min-w-[300px]"
                    onClick={() => handleSort('spendingName')}
                  >
                    支出先 {getSortIndicator('spendingName')}
                  </th>
                  <th
                    className={`px-4 py-2 text-left ${groupBySpending ? 'whitespace-nowrap w-28 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : 'min-w-[250px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                    onClick={() => handleSort(groupBySpending ? 'projectCount' : 'projectName')}
                  >
                    {groupBySpending ? `事業件数 ${getSortIndicator('projectCount')}` : `事業名 ${getSortIndicator('projectName')}`}
                  </th>
                  <th
                    className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 whitespace-nowrap"
                    onClick={() => handleSort('ministry')}
                  >
                    府省庁 {getSortIndicator('ministry')}
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
                    key={`${item.spendingName}-${idx}`}
                    className="border-t border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                  >
                    <td
                      className="px-4 py-2 text-gray-900 dark:text-white cursor-pointer hover:underline"
                      onClick={() => {
                        onSelectRecipient(item.spendingName);
                        onClose();
                      }}
                    >
                      {item.spendingName}
                    </td>
                    <td
                      className={`px-4 py-2 text-gray-900 dark:text-white ${!groupBySpending && item.projectName ? 'cursor-pointer hover:underline' : ''}`}
                      onClick={() => {
                        if (!groupBySpending && item.projectName && onSelectProject) {
                          onSelectProject(item.projectName);
                          onClose();
                        }
                      }}
                    >
                      {groupBySpending ? (item.projectCount || 0).toLocaleString() : item.projectName}
                    </td>
                    <td
                      className="px-4 py-2 whitespace-nowrap text-gray-900 dark:text-white cursor-pointer hover:underline"
                      onClick={() => handleMinistryClick(item)}
                    >
                      {item.ministry}
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

      {/* 府省庁別内訳モーダル */}
      {ministryBreakdownModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            {/* ヘッダー */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">府省庁別支出額</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {ministryBreakdownModal.spendingName}
                  </p>
                </div>
                <button
                  onClick={() => setMinistryBreakdownModal({ isOpen: false, spendingName: '', ministries: [] })}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 府省庁リスト */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-[5] shadow-sm">
                  <tr className="border-b-2 border-gray-300 dark:border-gray-600">
                    <th className="px-4 py-2 text-left">府省庁</th>
                    <th className="px-4 py-2 text-right">支出額</th>
                  </tr>
                </thead>
                <tbody>
                  {ministryBreakdownModal.ministries.map((m, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer"
                      onClick={() => handleMinistryBreakdownSelect(m.ministry)}
                    >
                      <td className="px-4 py-2 text-gray-900 dark:text-white hover:underline">
                        {m.ministry}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-900 dark:text-white">
                        {formatCurrency(m.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* フッター */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setMinistryBreakdownModal({ isOpen: false, spendingName: '', ministries: [] })}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
