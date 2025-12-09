'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResponsiveSankey } from '@nivo/sankey';
import type { RS2024PresetData } from '@/types/preset';
import type { RS2024StructuredData } from '@/types/structured';
import ProjectListModal from '@/client/components/ProjectListModal';
import SpendingListModal from '@/client/components/SpendingListModal';
import SummaryDialog from '@/client/components/SummaryDialog';

function SankeyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<RS2024PresetData | null>(null);
  const [structuredData, setStructuredData] = useState<RS2024StructuredData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Navigation State
  const [projectDrilldownLevel, setProjectDrilldownLevel] = useState(0); // Project drilldown: 0: Top10, 1: Top11-20, etc.
  const [viewMode, setViewMode] = useState<'global' | 'ministry' | 'project' | 'spending'>('global');
  const [selectedMinistry, setSelectedMinistry] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [drilldownLevel, setDrilldownLevel] = useState(0); // Ministry drilldown: 0: Top10, 1: Top11-20, 2: Top21-30, etc.

  // Settings State (ビュー別に整理)
  // 全体ビュー
  const [globalMinistryTopN, setGlobalMinistryTopN] = useState(10); // 府省庁TopN
  const [globalSpendingTopN, setGlobalSpendingTopN] = useState(10); // 支出先TopN

  // 府省庁ビュー
  const [ministryProjectTopN, setMinistryProjectTopN] = useState(10); // 事業TopN
  const [ministrySpendingTopN, setMinistrySpendingTopN] = useState(10); // 支出先TopN

  // 事業ビュー
  const [projectSpendingTopN, setProjectSpendingTopN] = useState(20); // 支出先TopN

  // 支出ビュー
  const [spendingProjectTopN, setSpendingProjectTopN] = useState(15); // 支出元事業TopN
  const [spendingMinistryTopN, setSpendingMinistryTopN] = useState(10); // 支出元府省庁TopN

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isProjectListOpen, setIsProjectListOpen] = useState(false);
  const [projectListFilters, setProjectListFilters] = useState<{
    ministries?: string[];
    projectName?: string;
    spendingName?: string;
    groupByProject?: boolean;
  } | undefined>(undefined);
  const [isSpendingListOpen, setIsSpendingListOpen] = useState(false);
  const [spendingListFilters, setSpendingListFilters] = useState<{
    ministries?: string[];
    projectName?: string;
    spendingName?: string;
    groupBySpending?: boolean;
  } | undefined>(undefined);

  // Temporary settings state for dialog
  const [tempGlobalMinistryTopN, setTempGlobalMinistryTopN] = useState(globalMinistryTopN);
  const [tempGlobalSpendingTopN, setTempGlobalSpendingTopN] = useState(globalSpendingTopN);
  const [tempMinistryProjectTopN, setTempMinistryProjectTopN] = useState(ministryProjectTopN);
  const [tempMinistrySpendingTopN, setTempMinistrySpendingTopN] = useState(ministrySpendingTopN);
  const [tempProjectSpendingTopN, setTempProjectSpendingTopN] = useState(projectSpendingTopN);
  const [tempSpendingProjectTopN, setTempSpendingProjectTopN] = useState(spendingProjectTopN);
  const [tempSpendingMinistryTopN, setTempSpendingMinistryTopN] = useState(spendingMinistryTopN);

  // Sync state from URL parameters (runs on mount and whenever URL changes via browser back/forward)
  useEffect(() => {
    const ministry = searchParams.get('ministry');
    const project = searchParams.get('project');
    const recipient = searchParams.get('recipient');
    const projectDrilldownLevelParam = searchParams.get('projectDrilldownLevel');
    const drilldownLevelParam = searchParams.get('drilldownLevel');

    // Set drilldownLevel
    setDrilldownLevel(parseInt(drilldownLevelParam || '0') || 0);
    setProjectDrilldownLevel(parseInt(projectDrilldownLevelParam || '0') || 0);

    if (recipient) {
      setViewMode('spending');
      setSelectedRecipient(recipient);
      setSelectedProject(null);
      setSelectedMinistry(null);
    } else if (project) {
      setViewMode('project');
      setSelectedProject(project);
      setSelectedRecipient(null);
      setSelectedMinistry(null);
    } else if (ministry) {
      setViewMode('ministry');
      setSelectedMinistry(ministry);
      setSelectedProject(null);
      setSelectedRecipient(null);
    } else {
      setViewMode('global');
      setSelectedMinistry(null);
      setSelectedProject(null);
      setSelectedRecipient(null);
    }
  }, [searchParams]);

  // Helper function to update URL (called from event handlers, not automatically)
  const navigateToView = (
    newViewMode: 'global' | 'ministry' | 'project' | 'spending',
    options: {
      ministry?: string | null;
      project?: string | null;
      recipient?: string | null;
      projectDrilldownLevel?: number;
      drilldownLevel?: number;
    } = {}
  ) => {
    const params = new URLSearchParams();

    if (newViewMode === 'spending' && options.recipient) {
      params.set('recipient', options.recipient);
    } else if (newViewMode === 'project' && options.project) {
      params.set('project', options.project);
    } else if (newViewMode === 'ministry' && options.ministry) {
      params.set('ministry', options.ministry);
      if (options.projectDrilldownLevel && options.projectDrilldownLevel > 0) {
        params.set('projectDrilldownLevel', options.projectDrilldownLevel.toString());
      }
    } else if (newViewMode === 'global') {
      if (options.drilldownLevel && options.drilldownLevel > 0) {
        params.set('drilldownLevel', options.drilldownLevel.toString());
      }
    }

    const newUrl = params.toString() ? `/sankey?${params.toString()}` : '/sankey';
    router.push(newUrl);
  };

  // Load structured data once for breadcrumb total amounts
  useEffect(() => {
    async function loadStructuredData() {
      try {
        const response = await fetch('/data/rs2024-structured.json');
        if (!response.ok) {
          throw new Error('Failed to load structured data');
        }
        const json: RS2024StructuredData = await response.json();
        setStructuredData(json);
      } catch (err) {
        console.error('Failed to load structured data:', err);
      }
    }

    loadStructuredData();
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const params = new URLSearchParams();

        if (viewMode === 'global') {
          params.set('limit', globalMinistryTopN.toString());
          params.set('projectLimit', '3'); // Fixed for global view to avoid clutter
          params.set('spendingLimit', globalSpendingTopN.toString());
          params.set('drilldownLevel', drilldownLevel.toString());
        } else if (viewMode === 'ministry' && selectedMinistry) {
          params.set('ministryName', selectedMinistry);
          params.set('projectLimit', ministryProjectTopN.toString());
          params.set('spendingLimit', ministrySpendingTopN.toString());
          params.set('projectDrilldownLevel', projectDrilldownLevel.toString());
        } else if (viewMode === 'project' && selectedProject) {
          params.set('projectName', selectedProject);
          params.set('spendingLimit', projectSpendingTopN.toString());
        } else if (viewMode === 'spending' && selectedRecipient) {
          params.set('recipientName', selectedRecipient);
          params.set('projectLimit', spendingProjectTopN.toString());
          params.set('projectDrilldownLevel', projectDrilldownLevel.toString());
          params.set('limit', spendingMinistryTopN.toString());
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
  }, [projectDrilldownLevel, globalMinistryTopN, globalSpendingTopN, ministryProjectTopN, ministrySpendingTopN, projectSpendingTopN, spendingProjectTopN, spendingMinistryTopN, viewMode, selectedMinistry, selectedProject, selectedRecipient, drilldownLevel]);

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
      // Increment drilldown level to show next TopN ministries
      const newLevel = drilldownLevel + 1;
      navigateToView('global', { drilldownLevel: newLevel });
      return;
    }

    // Handle "Total Budget" (予算総計) - but NOT in Project View where it represents a ministry
    if (actualNode.id === 'total-budget' && viewMode !== 'project') {
      if (viewMode === 'global') {
        // 全体ビュー: 事業一覧を開く（府省庁:すべて、支出先まとめ:維持）
        setProjectListFilters({
          ministries: undefined, // All
          projectName: '',
          spendingName: '',
          groupByProject: undefined // Keep previous
        });
        setIsProjectListOpen(true);
      } else if (viewMode === 'ministry') {
        navigateToView('global', { drilldownLevel });
      }
      return;
    }

    // Handle Ministry nodes
    // In Project View, the 'total-budget' node displays the ministry name and should be clickable
    const isMinistryNode = actualNode.type === 'ministry-budget' &&
      actualNode.id !== 'ministry-budget-other' &&
      (actualNode.id !== 'total-budget' || viewMode === 'project');

    if (isMinistryNode) {
      if (viewMode === 'ministry') {
        // 府省庁ビュー: 事業一覧を開く（府省庁:選択中、支出先まとめ:維持）
        setProjectListFilters({
          ministries: [actualNode.name],
          projectName: '',
          spendingName: '',
          groupByProject: undefined // Keep previous
        });
        setIsProjectListOpen(true);
      } else if (viewMode === 'project') {
        // 事業ビュー: 府省庁ビューへ遷移
        navigateToView('ministry', { ministry: actualNode.name, projectDrilldownLevel: 0 });
      } else if (viewMode === 'spending') {
        // 支出ビュー: 府省庁ビューへ遷移
        navigateToView('ministry', { ministry: actualNode.name, projectDrilldownLevel: 0 });
      } else {
        // Global View: Go to Ministry View (Standard behavior)
        navigateToView('ministry', { ministry: actualNode.name, projectDrilldownLevel: 0 });
      }
      return;
    }

    // Handle Project nodes
    if (actualNode.type === 'project-budget' || actualNode.type === 'project-spending') {
      // Special handling for "事業(TopN以外)" and "事業(TopN以外府省庁)" aggregate nodes
      if (actualNode.name.match(/^事業\(Top\d+以外.*\)$/)) {
        if (viewMode === 'ministry') {
          navigateToView('ministry', { ministry: selectedMinistry, projectDrilldownLevel: projectDrilldownLevel + 1 });
        } else if (viewMode === 'spending') {
          navigateToView('spending', { recipient: selectedRecipient, projectDrilldownLevel: projectDrilldownLevel + 1 });
        }
        // Global view: no action needed (handled by drilldownLevel)
        return;
      }

      if (viewMode === 'project') {
        // 事業ビュー: 事業一覧を開く（府省庁:すべて、事業名:選択中、支出先まとめ:維持）
        setProjectListFilters({
          ministries: undefined, // All (or should it be restricted to current ministry if selected? User said "府省庁フィルタすべて")
          projectName: actualNode.name,
          spendingName: '',
          groupByProject: undefined // Keep previous
        });
        setIsProjectListOpen(true);
      } else if (viewMode === 'spending') {
        // 支出ビュー: 事業ビューへ遷移
        navigateToView('project', { project: actualNode.name });
      } else {
        // Global/Ministry View: Go to Project View (Standard behavior)
        navigateToView('project', { project: actualNode.name });
      }
      return;
    }

    // Handle Recipient nodes
    if (actualNode.type === 'recipient') {
      // Special handling for "その他"
      if (actualNode.name === 'その他') {
        navigateToView('spending', { recipient: 'その他' });
        return;
      }

      // Handle "支出先(TopN以外)"
      if (actualNode.name.match(/^支出先\(Top\d+以外\)$/)) {
        // No action needed for global view (handled by drilldownLevel)
        return;
      }

      if (viewMode === 'spending') {
        // 支出ビュー: 事業一覧を開く（府省庁:すべて、支出先:選択中、支出先まとめ:OFF）
        setProjectListFilters({
          ministries: undefined, // All
          projectName: '',
          spendingName: actualNode.name,
          groupByProject: false // OFF
        });
        setIsProjectListOpen(true);
      } else {
        // Other views: Go to Spending View (Standard behavior)
        navigateToView('spending', { recipient: actualNode.name });
      }
      return;
    }
  };

  const handleReset = () => {
    navigateToView('global', { drilldownLevel: 0 });
  };

  const handleSelectProject = (projectName: string) => {
    navigateToView('project', { project: projectName });
  };

  const handleSelectMinistry = (ministryName: string) => {
    navigateToView('ministry', { ministry: ministryName, projectDrilldownLevel: 0 });
  };

  const handleSelectRecipient = (recipientName: string) => {
    navigateToView('spending', { recipient: recipientName });
  };

  const openSettings = () => {
    setTempGlobalMinistryTopN(globalMinistryTopN);
    setTempGlobalSpendingTopN(globalSpendingTopN);
    setTempMinistryProjectTopN(ministryProjectTopN);
    setTempMinistrySpendingTopN(ministrySpendingTopN);
    setTempProjectSpendingTopN(projectSpendingTopN);
    setTempSpendingProjectTopN(spendingProjectTopN);
    setTempSpendingMinistryTopN(spendingMinistryTopN);
    setIsSettingsOpen(true);
  };

  const saveSettings = () => {
    setGlobalMinistryTopN(tempGlobalMinistryTopN);
    setGlobalSpendingTopN(tempGlobalSpendingTopN);
    setMinistryProjectTopN(tempMinistryProjectTopN);
    setMinistrySpendingTopN(tempMinistrySpendingTopN);
    setProjectSpendingTopN(tempProjectSpendingTopN);
    setSpendingProjectTopN(tempSpendingProjectTopN);
    setSpendingMinistryTopN(tempSpendingMinistryTopN);
    setIsSettingsOpen(false);
    // Reset drilldown level and offsets if TopN changes to avoid weird states
    if (tempGlobalMinistryTopN !== globalMinistryTopN) {
      setDrilldownLevel(0);
    }
    if (tempMinistryProjectTopN !== ministryProjectTopN) {
      setProjectDrilldownLevel(0);
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
  // Helper function to convert dummy values (0.001) to actual values (0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getActualValue = (value: number | undefined, nodeOrDetails?: any): number | undefined => {
    if (value === undefined || value === null) return value;

    // If value is 0.001 (dummy value), check if it should be 0
    if (value === 0.001) {
      // Check if this node has totalBudget === 0 in details
      if (nodeOrDetails?.details?.totalBudget === 0) {
        return 0;
      }
      // For other cases with dummy value, also return 0
      return 0;
    }

    return value;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatCurrency = (value: number | undefined, nodeOrDetails?: any) => {
    // Convert dummy values to actual values
    const actualValue = getActualValue(value, nodeOrDetails);

    if (actualValue === undefined || actualValue === null) return '---';
    if (actualValue === 0) return '0円';

    if (actualValue >= 1e12) {
      const trillions = actualValue / 1e12;
      const integerDigits = Math.floor(trillions).toString().length;
      if (integerDigits >= 4) {
        return `${Math.round(trillions).toLocaleString('ja-JP')}兆円`;
      } else if (integerDigits === 3) {
        return `${trillions.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}兆円`;
      } else {
        return `${trillions.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}兆円`;
      }
    } else if (actualValue >= 1e8) {
      const hundreds = actualValue / 1e8;
      const integerDigits = Math.floor(hundreds).toString().length;
      if (integerDigits >= 4) {
        return `${Math.round(hundreds).toLocaleString('ja-JP')}億円`;
      } else if (integerDigits === 3) {
        return `${hundreds.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}億円`;
      } else {
        return `${hundreds.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}億円`;
      }
    } else if (actualValue >= 1e4) {
      const tenThousands = actualValue / 1e4;
      const integerDigits = Math.floor(tenThousands).toString().length;
      if (integerDigits >= 4) {
        return `${Math.round(tenThousands).toLocaleString('ja-JP')}万円`;
      } else if (integerDigits === 3) {
        return `${tenThousands.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}万円`;
      } else {
        return `${tenThousands.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}万円`;
      }
    } else {
      return `${actualValue.toLocaleString('ja-JP')}円`;
    }
  };

  // Get budget and spending amounts for current view
  const getViewAmounts = () => {
    if (!structuredData) return { budget: 0, spending: 0 };

    if (viewMode === 'global') {
      return {
        budget: structuredData.metadata.totalBudgetAmount,
        spending: structuredData.metadata.totalSpendingAmount,
      };
    } else if (viewMode === 'ministry' && selectedMinistry) {
      const ministry = structuredData.budgetTree.ministries.find(m => m.name === selectedMinistry);
      const ministryBudget = ministry?.totalBudget || 0;

      // Calculate total spending for this ministry
      const ministryProjects = structuredData.budgets.filter(b => b.ministry === selectedMinistry);
      const ministrySpending = ministryProjects.reduce((sum, p) => sum + p.totalSpendingAmount, 0);

      return { budget: ministryBudget, spending: ministrySpending };
    } else if (viewMode === 'project' && selectedProject) {
      const project = structuredData.budgets.find(b => b.projectName === selectedProject);
      return {
        budget: project?.totalBudget || 0,
        spending: project?.totalSpendingAmount || 0,
      };
    } else if (viewMode === 'spending' && selectedRecipient) {
      const recipient = structuredData.spendings.find(s => s.spendingName === selectedRecipient);

      // For spending view, calculate total budget from all projects that pay this recipient
      let totalBudget = 0;
      if (recipient) {
        recipient.projects.forEach(proj => {
          const budget = structuredData.budgets.find(b => b.projectId === proj.projectId);
          if (budget) {
            totalBudget += budget.totalBudget;
          }
        });
      }

      return {
        budget: totalBudget,
        spending: recipient?.totalSpendingAmount || 0,
      };
    }

    return { budget: 0, spending: 0 };
  };

  const viewAmounts = getViewAmounts();

  // Build breadcrumb items
  const getBreadcrumbs = () => {
    const breadcrumbs: Array<{ label: string; amount: number | undefined; onClick: () => void }> = [];

    // Total Budget (always present)
    breadcrumbs.push({
      label: '予算総計',
      amount: metadata.summary.totalBudget,
      onClick: handleReset,
    });

    // Ministry level
    if (selectedMinistry && structuredData) {
      // Get total budget for selected ministry from budgetTree
      const ministry = structuredData.budgetTree.ministries.find(m => m.name === selectedMinistry);
      const ministryAmount = ministry?.totalBudget || metadata.summary.selectedBudget;

      breadcrumbs.push({
        label: selectedMinistry,
        amount: ministryAmount,
        onClick: () => {
          navigateToView('ministry', { ministry: selectedMinistry, projectDrilldownLevel: 0 });
        },
      });
    }

    // Project level
    if (selectedProject && structuredData) {
      // Get total budget for selected project from budgets array
      const project = structuredData.budgets.find(b => b.projectName === selectedProject);
      const projectAmount = project?.totalBudget;

      breadcrumbs.push({
        label: selectedProject,
        amount: projectAmount,
        onClick: () => {
          navigateToView('project', { project: selectedProject });
        },
      });
    }

    // Recipient level
    if (selectedRecipient && structuredData) {
      // Get total spending amount for selected recipient from spendings array
      const recipient = structuredData.spendings.find(s => s.spendingName === selectedRecipient);
      const recipientAmount = recipient?.totalSpendingAmount;

      breadcrumbs.push({
        label: selectedRecipient,
        amount: recipientAmount,
        onClick: () => {
          // Already at this level, no action
        },
      });
    }

    return breadcrumbs;
  };

  const breadcrumbs = data ? getBreadcrumbs() : [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 固定ボタン */}
      <div className="fixed top-4 right-4 z-40 flex gap-2">
        <button
          onClick={() => setIsProjectListOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-lg"
          aria-label="事業一覧"
        >
          事業一覧
        </button>
        <button
          onClick={() => setIsSpendingListOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-lg"
          aria-label="支出先一覧"
        >
          支出先一覧
        </button>
        <button
          onClick={openSettings}
          className="p-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors shadow-lg"
          aria-label="設定"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-8">
        {/* ヘッダー */}
        <div className="mb-3 top-0 bg-gray-50 dark:bg-gray-900 z-30 py-2 border-b border-gray-200 dark:border-gray-800 shadow-sm">
          <div>
            <div className="flex items-start justify-between">
              <div>
                {/* 1行目: ビュー名 + 概要ボタン */}
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {viewMode === 'global' && '全体'}
                    {viewMode === 'ministry' && '府省庁'}
                    {viewMode === 'project' && '事業'}
                    {viewMode === 'spending' && '支出先'}
                  </div>
                  <button
                    onClick={() => setIsSummaryOpen(true)}
                    className="p-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 transition-colors"
                    aria-label="概要を表示"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                    </svg>
                  </button>
                </div>

                {/* 2行目: 名称または年度 */}
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  {viewMode === 'global' && structuredData && `予算年度${structuredData.metadata.fiscalYear}年`}
                  {viewMode === 'ministry' && selectedMinistry}
                  {viewMode === 'project' && selectedProject}
                  {viewMode === 'spending' && selectedRecipient}
                </h1>

                {/* 3行目: 予算→支出 */}
                <div className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                  予算{formatCurrency(viewAmounts.budget)}→支出{formatCurrency(viewAmounts.spending)}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* パンくずリスト */}
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center gap-2">
                <button
                  onClick={crumb.onClick}
                  className={`px-4 py-3 rounded-lg shadow transition-colors ${index === breadcrumbs.length - 1
                    ? 'bg-blue-600 text-white cursor-default'
                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  disabled={index === breadcrumbs.length - 1}
                >
                  <div className="text-sm font-semibold">{crumb.label}</div>
                  <div className="text-xs mt-1">{formatCurrency(crumb.amount)}</div>
                </button>
                {index < breadcrumbs.length - 1 && (
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* サンキー図 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 relative">
          {/* ノード色の凡例 */}
          <div className="flex items-center gap-6 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#10b981]"></span>
              <span className="text-gray-700 dark:text-gray-300">予算ノード</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#ef4444]"></span>
              <span className="text-gray-700 dark:text-gray-300">支出ノード</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#6b7280]"></span>
              <span className="text-gray-700 dark:text-gray-300">その他</span>
            </div>
          </div>

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
                  : { top: 40, right: 100, bottom: 40, left: 100 }
                }
                align="justify"
                sort="input"
                nodeInnerPadding={0}
                colors={(node) => {
                  const nodeData = sankey.nodes.find(n => n.id === node.id);
                  const type = nodeData?.type;
                  const name = nodeData?.name || '';

                  // TopN以外ノードと"その他"ノードはすべてグレー
                  if (name.startsWith('その他') ||
                    name.match(/^府省庁\(Top\d+以外.*\)$/) ||
                    name.match(/^事業\(Top\d+以外.*\)$/) ||
                    name.match(/^支出先\(Top\d+以外.*\)$/)) {
                    return '#6b7280'; // グレー系
                  }

                  // 予算系（緑系）、支出系（赤系）
                  if (type === 'ministry-budget' || type === 'project-budget') {
                    return '#10b981'; // 緑系
                  } else if (type === 'project-spending' || type === 'recipient') {
                    return '#ef4444'; // 赤系
                  }
                  return '#6b7280'; // グレー系
                }}
                nodeOpacity={1}
                nodeHoverOthersOpacity={0.35}
                nodeThickness={44}
                nodeSpacing={22}
                nodeBorderWidth={0}
                nodeBorderColor={{
                  from: 'color',
                  modifiers: [['darker', 0.8]],
                }}
                linkOpacity={0.5}
                linkHoverOthersOpacity={0.1}
                linkContract={3}
                enableLinkGradient={false}
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

                      // For nodes with dummy value (0.001), show actual amount (0円)
                      let displayAmount = node.value;
                      if (node.value === 0.001) {
                        // Check if this is truly a zero-budget case
                        if (nodeType === 'project-budget' &&
                          actualNode?.details &&
                          'totalBudget' in actualNode.details &&
                          actualNode.details.totalBudget === 0) {
                          displayAmount = 0;
                        } else if (nodeType === 'ministry-budget') {
                          // Ministry nodes shouldn't have dummy values, but handle just in case
                          displayAmount = 0;
                        }
                      }
                      const amount = formatCurrency(displayAmount);

                      let displayName = name;

                      // Dynamic label for "事業(TopN以外)" based on drilldown level
                      if (name.match(/^事業\(Top\d+以外.*\)$/) && viewMode === 'ministry') {
                        const currentEnd = (projectDrilldownLevel + 1) * ministryProjectTopN;
                        displayName = `事業(Top${currentEnd}以外)`;
                      } else if (nodeType === 'project-budget') {
                        displayName = name.length > 10 ? name.substring(0, 10) + '...' : name;
                      } else if (nodeType === 'project-spending') {
                        displayName = name.length > 10 ? name.substring(0, 10) + '...' : name;
                      } else if (name.length > 10) {
                        displayName = name.substring(0, 10) + '...';
                      }

                      // Position based on node type: budget nodes on left, spending nodes on right
                      const isBudgetNode = nodeType === 'ministry-budget' || nodeType === 'project-budget';
                      const x = isBudgetNode ? node.x - 4 : node.x + node.width + 4;
                      const textAnchor = isBudgetNode ? 'end' : 'start';

                      // X position for amount label (centered above node)
                      const amountX = node.x + node.width / 2;

                      // Clickable indication
                      const nodeName = actualNode?.name || '';
                      const isProjectOtherNode = nodeName.match(/^事業\(Top\d+以外.*\)$/);
                      const isGlobalView = viewMode === 'global';

                      const isClickable =
                        node.id === 'ministry-budget-other' ||
                        node.id === 'total-budget' ||
                        (nodeType === 'ministry-budget' && node.id !== 'total-budget' && node.id !== 'ministry-budget-other') ||
                        ((nodeType === 'project-budget' || nodeType === 'project-spending') && !(isProjectOtherNode && isGlobalView)) ||
                        (nodeType === 'recipient');

                      const cursorStyle = isClickable ? 'pointer' : 'default';
                      const fontWeight = isClickable ? 'bold' : 500;
                      const color = isClickable ? '#2563eb' : '#1f2937'; // Blue if clickable

                      return (
                        <g key={node.id} style={{ cursor: cursorStyle }}>
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
                              fill: color,
                              fontSize: 12,
                              fontWeight: fontWeight,
                              pointerEvents: isClickable ? 'auto' : 'none',
                              cursor: cursorStyle,
                            }}
                            onClick={() => isClickable && handleNodeClick(node)}
                          >
                            {displayName}
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
                  const value = formatCurrency(node.value, actualNode);

                  // ノードタイプに応じてタイトルを調整
                  let title = name;
                  if (nodeType === 'project-budget') {
                    title = `(予算) ${name}`;
                  } else if (nodeType === 'project-spending') {
                    title = `(支出) ${name}`;
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
                  // Find actual nodes and link data
                  const sourceNode = sankey.nodes.find(n => n.id === link.source.id);
                  const targetNode = sankey.nodes.find(n => n.id === link.target.id);
                  const actualLink = sankey.links.find(l => l.source === link.source.id && l.target === link.target.id);

                  const sourceName = sourceNode?.name || link.source.id;
                  const targetName = targetNode?.name || link.target.id;
                  const sourceValue = formatCurrency(link.source.value, sourceNode);
                  const targetValue = formatCurrency(link.target.value, targetNode);
                  const linkValue = formatCurrency(link.value, sourceNode);

                  // 事業(予算) → 事業(支出) のリンクかどうかチェック
                  const isProjectBudgetToSpending =
                    sourceNode?.type === 'project-budget' &&
                    targetNode?.type === 'project-spending';

                  // タイトルとラベルを決定
                  let title = '';
                  let sourceLabel = '送信元';
                  let targetLabel = '送信先';

                  if (isProjectBudgetToSpending) {
                    // 事業ノード間のリンク
                    title = sourceName; // 事業名をタイトルに
                    sourceLabel = '予算';
                    targetLabel = '支出';
                  } else {
                    // その他のリンク：ノードタイプに基づいてタイトルを決定
                    if (sourceNode?.type === 'ministry-budget') {
                      title = `${sourceName} → 事業`;
                    } else if (sourceNode?.type === 'project-spending') {
                      title = `${sourceName} → 支出先`;
                    } else {
                      title = '資金の流れ';
                    }
                  }

                  return (
                    <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded shadow-lg border border-gray-200 dark:border-gray-700 max-w-md">
                      {/* タイトル */}
                      <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 border-b border-gray-200 dark:border-gray-600 pb-2">
                        {title}
                      </div>

                      {/* 送信元 */}
                      <div className="mb-2">
                        {isProjectBudgetToSpending && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{sourceLabel}</div>
                        )}
                        {!isProjectBudgetToSpending && (
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {sourceName}
                          </div>
                        )}
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {sourceValue}
                        </div>
                      </div>

                      {/* 矢印と流れる金額 */}
                      <div className="text-center my-2">
                        <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          ↓
                        </div>
                      </div>

                      {/* 送信先 */}
                      <div className="mb-2">
                        {isProjectBudgetToSpending && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{targetLabel}</div>
                        )}
                        {!isProjectBudgetToSpending && (
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {targetName}
                          </div>
                        )}
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {targetValue}
                        </div>
                      </div>

                      {/* リンク詳細情報 */}
                      {actualLink?.details && (actualLink.details.contractMethod || actualLink.details.blockName) && (
                        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                          {actualLink.details.contractMethod && (
                            <div className="mb-1">
                              <span className="text-xs text-gray-500 dark:text-gray-400">契約方式: </span>
                              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                {actualLink.details.contractMethod}
                              </span>
                            </div>
                          )}
                          {actualLink.details.blockName && (
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">支出ブロック: </span>
                              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                {actualLink.details.blockName}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </div>
          </div>

          {/* Return to TopN Selector */}
          {viewMode === 'global' && (
            <div className="mb-4 flex items-center gap-2">
              <label htmlFor="topn-selector" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                府省庁Top
              </label>
              <button
                onClick={() => {
                  if (drilldownLevel > 0) {
                    const newLevel = drilldownLevel - 1;
                    setDrilldownLevel(newLevel);
                  }
                }}
                disabled={drilldownLevel === 0}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-700"
                aria-label="前のTopNへ"
              >
                ▲
              </button>
              <select
                id="topn-selector"
                value={drilldownLevel}
                onChange={(e) => {
                  const newLevel = parseInt(e.target.value);
                  setDrilldownLevel(newLevel);
                }}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                {(() => {
                  const totalMinistries = metadata.summary.totalMinistries || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalMinistries / globalMinistryTopN) - 1);
                  return Array.from({ length: maxLevel + 1 }, (_, i) => {
                    const level = i;
                    const startNum = level * globalMinistryTopN + 1;
                    const endNum = Math.min((level + 1) * globalMinistryTopN, totalMinistries);
                    return (
                      <option key={level} value={level}>
                        {startNum}-{endNum}
                      </option>
                    );
                  });
                })()}
              </select>
              <button
                onClick={() => {
                  const totalMinistries = metadata.summary.totalMinistries || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalMinistries / globalMinistryTopN) - 1);
                  if (drilldownLevel < maxLevel) {
                    const newLevel = drilldownLevel + 1;
                    setDrilldownLevel(newLevel);
                  }
                }}
                disabled={(() => {
                  const totalMinistries = metadata.summary.totalMinistries || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalMinistries / globalMinistryTopN) - 1);
                  return drilldownLevel >= maxLevel;
                })()}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-700"
                aria-label="次のTopNへ"
              >
                ▼
              </button>
              <span className="text-sm text-gray-700 dark:text-gray-300">へ</span>
            </div>
          )}

          {/* Ministry View: Project TopN Selector */}
          {viewMode === 'ministry' && metadata.summary.ministryTotalProjects && metadata.summary.ministryTotalProjects > ministryProjectTopN && (
            <div className="mb-4 flex items-center gap-2">
              <label htmlFor="project-topn-selector" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                事業Top
              </label>
              <button
                onClick={() => {
                  if (projectDrilldownLevel > 0) {
                    setProjectDrilldownLevel(prev => prev - 1);
                  }
                }}
                disabled={projectDrilldownLevel === 0}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-700"
                aria-label="前のTopNへ"
              >
                ▲
              </button>
              <select
                id="project-topn-selector"
                value={projectDrilldownLevel}
                onChange={(e) => {
                  const newLevel = parseInt(e.target.value);
                  setProjectDrilldownLevel(newLevel);
                }}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                {(() => {
                  const totalProjects = metadata.summary.ministryTotalProjects || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalProjects / ministryProjectTopN) - 1);
                  return Array.from({ length: maxLevel + 1 }, (_, i) => {
                    const level = i;
                    const startNum = level * ministryProjectTopN + 1;
                    const endNum = Math.min((level + 1) * ministryProjectTopN, totalProjects);
                    return (
                      <option key={level} value={level}>
                        {startNum}-{endNum}
                      </option>
                    );
                  });
                })()}
              </select>
              <button
                onClick={() => {
                  const totalProjects = metadata.summary.ministryTotalProjects || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalProjects / ministryProjectTopN) - 1);
                  if (projectDrilldownLevel < maxLevel) {
                    setProjectDrilldownLevel(prev => prev + 1);
                  }
                }}
                disabled={(() => {
                  const totalProjects = metadata.summary.ministryTotalProjects || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalProjects / ministryProjectTopN) - 1);
                  return projectDrilldownLevel >= maxLevel;
                })()}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-700"
                aria-label="次のTopNへ"
              >
                ▼
              </button>
              <span className="text-sm text-gray-700 dark:text-gray-300">へ</span>
            </div>
          )}
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
            >
              ✕
            </button>
            <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-gray-100">TopN表示設定</h2>

            {/* 全体ビュー */}
            <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">全体ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    府省庁TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempGlobalMinistryTopN}
                    onChange={(e) => setTempGlobalMinistryTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    支出先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempGlobalSpendingTopN}
                    onChange={(e) => setTempGlobalSpendingTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
              </div>
            </div>

            {/* 府省庁ビュー */}
            <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">府省庁ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    事業TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempMinistryProjectTopN}
                    onChange={(e) => setTempMinistryProjectTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    支出先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempMinistrySpendingTopN}
                    onChange={(e) => setTempMinistrySpendingTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
              </div>
            </div>

            {/* 事業ビュー */}
            <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">事業ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    支出先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempProjectSpendingTopN}
                    onChange={(e) => setTempProjectSpendingTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 20</p>
                </div>
              </div>
            </div>

            {/* 支出ビュー */}
            <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">支出ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    支出元事業TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempSpendingProjectTopN}
                    onChange={(e) => setTempSpendingProjectTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 15</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    支出元府省庁TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempSpendingMinistryTopN}
                    onChange={(e) => setTempSpendingMinistryTopN(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
              </div>
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

      {/* 事業一覧ダイアログ */}
      <ProjectListModal
        isOpen={isProjectListOpen}
        onClose={() => {
          setIsProjectListOpen(false);
          // モーダルを閉じたら、ノードクリックで設定されたフィルタをリセット
          setProjectListFilters({
            ministries: undefined,
            projectName: '',
            spendingName: '',
            groupByProject: undefined
          });
        }}
        onSelectProject={handleSelectProject}
        onSelectMinistry={handleSelectMinistry}
        onSelectRecipient={handleSelectRecipient}
        initialFilters={projectListFilters}
      />

      {/* 支出先一覧ダイアログ */}
      <SpendingListModal
        isOpen={isSpendingListOpen}
        onClose={() => setIsSpendingListOpen(false)}
        onSelectRecipient={handleSelectRecipient}
        onSelectMinistry={handleSelectMinistry}
        onSelectProject={handleSelectProject}
        initialFilters={spendingListFilters}
      />

      {/* 概要ダイアログ */}
      <SummaryDialog
        isOpen={isSummaryOpen}
        onClose={() => setIsSummaryOpen(false)}
        metadata={metadata}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

export default function SankeyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">読み込み中...</p>
        </div>
      </div>
    }>
      <SankeyContent />
    </Suspense>
  );
}
