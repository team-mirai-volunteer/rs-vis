'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResponsiveSankey } from '@nivo/sankey';
import type { RS2024PresetData } from '@/types/preset';
import type { RS2024StructuredData } from '@/types/structured';
import { DEFAULT_VIEW_STATE, DEFAULT_TOPN_SETTINGS, DEFAULT_DIALOG_STATES, type ViewState, type TopNSettings, type DialogStates } from '@/types/view-state';
import ProjectListModal from '@/client/components/ProjectListModal';
import SpendingListModal from '@/client/components/SpendingListModal';
import ProjectDetailPanel from '@/client/components/ProjectDetailPanel';
import SubcontractDetailDialog from '@/client/components/SubcontractDetailDialog';
import RecipientRangeSlider from '@/client/components/RecipientRangeSlider';

function SankeyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<RS2024PresetData | null>(null);
  const [structuredData, setStructuredData] = useState<RS2024StructuredData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Navigation State (統合)
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);

  // TopN Settings State (統合)
  const [topNSettings, setTopNSettings] = useState<TopNSettings>(DEFAULT_TOPN_SETTINGS);
  const [tempTopNSettings, setTempTopNSettings] = useState<TopNSettings>(DEFAULT_TOPN_SETTINGS);

  // Dialog States (統合)
  const [dialogStates, setDialogStates] = useState<DialogStates>(DEFAULT_DIALOG_STATES);

  const [projectListFilters, setProjectListFilters] = useState<{
    ministries?: string[];
    projectName?: string;
    spendingName?: string;
    groupByProject?: boolean;
  } | undefined>(undefined);
  const [spendingListFilters, setSpendingListFilters] = useState<{
    ministries?: string[];
    projectName?: string;
    spendingName?: string;
    groupBySpending?: boolean;
  } | undefined>(undefined);

  // 再委託先詳細情報
  const [subcontractDetail, setSubcontractDetail] = useState<{
    name: string;
    sourceRecipient: string;
    totalAmount: number;
    flowTypes: string;
    projects: { projectId: number; projectName: string; amount: number }[];
    furtherOutflows?: { name: string; amount: number; flowType: string }[];
    subcontracts?: { name: string; amount: number; flowType: string }[];
  } | null>(null);

  // Sync state from URL parameters (runs on mount and whenever URL changes via browser back/forward)
  useEffect(() => {
    const ministry = searchParams.get('ministry');
    const project = searchParams.get('project');
    const recipient = searchParams.get('recipient');
    const projectDrilldownLevelParam = searchParams.get('projectDrilldownLevel');
    const drilldownLevelParam = searchParams.get('drilldownLevel');
    const spendingDrilldownLevelParam = searchParams.get('spendingDrilldownLevel');

    const newViewState: ViewState = {
      mode: 'global',
      selectedMinistry: null,
      selectedProject: null,
      selectedRecipient: null,
      drilldownLevel: parseInt(drilldownLevelParam || '0') || 0,
      projectDrilldownLevel: parseInt(projectDrilldownLevelParam || '0') || 0,
      spendingDrilldownLevel: parseInt(spendingDrilldownLevelParam || '0') || 0,
    };

    if (recipient) {
      newViewState.mode = 'spending';
      newViewState.selectedRecipient = recipient;
    } else if (project) {
      newViewState.mode = 'project';
      newViewState.selectedProject = project;
    } else if (ministry) {
      newViewState.mode = 'ministry';
      newViewState.selectedMinistry = ministry;
    }

    setViewState(newViewState);
  }, [searchParams]);

  // Helper function to update URL (called from event handlers, not automatically)
  const navigateToView = (updates: Partial<ViewState>) => {
    // 現在の状態をベースに更新を適用
    const newState = { ...viewState, ...updates };
    const params = new URLSearchParams();

    if (newState.mode === 'spending' && newState.selectedRecipient) {
      params.set('recipient', newState.selectedRecipient);
    } else if (newState.mode === 'project' && newState.selectedProject) {
      params.set('project', newState.selectedProject);
    } else if (newState.mode === 'ministry' && newState.selectedMinistry) {
      params.set('ministry', newState.selectedMinistry);
      if (newState.projectDrilldownLevel > 0) {
        params.set('projectDrilldownLevel', newState.projectDrilldownLevel.toString());
      }
    } else if (newState.mode === 'global') {
      if (newState.drilldownLevel > 0) {
        params.set('drilldownLevel', newState.drilldownLevel.toString());
      }
      if (newState.spendingDrilldownLevel > 0) {
        params.set('spendingDrilldownLevel', newState.spendingDrilldownLevel.toString());
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

        if (viewState.mode === 'global') {
          params.set('limit', topNSettings.global.ministry.toString());
          params.set('projectLimit', '3'); // Fixed for global view to avoid clutter
          params.set('spendingLimit', topNSettings.global.spending.toString());
          params.set('subcontractLimit', topNSettings.global.subcontract.toString());
          params.set('drilldownLevel', viewState.drilldownLevel.toString());
          params.set('spendingDrilldownLevel', viewState.spendingDrilldownLevel.toString());
        } else if (viewState.mode === 'ministry' && viewState.selectedMinistry) {
          params.set('ministryName', viewState.selectedMinistry);
          params.set('projectLimit', topNSettings.ministry.project.toString());
          params.set('spendingLimit', topNSettings.ministry.spending.toString());
          params.set('projectDrilldownLevel', viewState.projectDrilldownLevel.toString());
        } else if (viewState.mode === 'project' && viewState.selectedProject) {
          params.set('projectName', viewState.selectedProject);
          params.set('spendingLimit', topNSettings.project.spending.toString());
        } else if (viewState.mode === 'spending' && viewState.selectedRecipient) {
          params.set('recipientName', viewState.selectedRecipient);
          params.set('projectLimit', topNSettings.spending.project.toString());
          params.set('projectDrilldownLevel', viewState.projectDrilldownLevel.toString());
          params.set('limit', topNSettings.spending.ministry.toString());
          params.set('subcontractLimit', topNSettings.spending.subcontract.toString());
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
  }, [viewState, topNSettings]);

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
      const newLevel = viewState.drilldownLevel + 1;
      navigateToView({ mode: 'global', drilldownLevel: newLevel });
      return;
    }

    // Handle "Total Budget" (予算総計) - but NOT in Project View where it represents a ministry
    if (actualNode.id === 'total-budget' && viewState.mode !== 'project') {
      if (viewState.mode === 'global') {
        // 全体ビュー: 事業一覧を開く（府省庁:すべて、支出先まとめ:維持）
        setProjectListFilters({
          ministries: undefined, // All
          projectName: '',
          spendingName: '',
          groupByProject: undefined // Keep previous
        });
        setDialogStates(prev => ({ ...prev, projectList: true }));
      } else if (viewState.mode === 'ministry') {
        navigateToView({ mode: 'global' });
      }
      return;
    }

    // Handle Ministry nodes
    // In Project View, the 'total-budget' node displays the ministry name and should be clickable
    const isMinistryNode = actualNode.type === 'ministry-budget' &&
      actualNode.id !== 'ministry-budget-other' &&
      (actualNode.id !== 'total-budget' || viewState.mode === 'project');

    if (isMinistryNode) {
      // Remove "(TopN以外)" suffix from ministry name if present
      const ministryName = actualNode.name.replace(/\n?\(Top\d+以外\)$/, '');

      if (viewState.mode === 'ministry') {
        // 府省庁ビュー: 事業一覧を開く（府省庁:選択中、支出先まとめ:維持）
        setProjectListFilters({
          ministries: [ministryName],
          projectName: '',
          spendingName: '',
          groupByProject: undefined // Keep previous
        });
        setDialogStates(prev => ({ ...prev, projectList: true }));
      } else if (viewState.mode === 'project') {
        // 事業ビュー: 府省庁ビューへ遷移
        navigateToView({ mode: 'ministry', selectedMinistry: ministryName, projectDrilldownLevel: 0 });
      } else if (viewState.mode === 'spending') {
        // 支出ビュー: 府省庁ビューへ遷移
        navigateToView({ mode: 'ministry', selectedMinistry: ministryName, projectDrilldownLevel: 0 });
      } else {
        // Global View: Go to Ministry View (Standard behavior)
        navigateToView({ mode: 'ministry', selectedMinistry: ministryName, projectDrilldownLevel: 0 });
      }
      return;
    }

    // Handle Project nodes
    if (actualNode.type === 'project-budget' || actualNode.type === 'project-spending') {
      // Disable click for "事業(TopN)" cumulative nodes (drilldown summary)
      if (actualNode.id === 'project-budget-cumulative' || actualNode.id === 'project-spending-cumulative') {
        return; // No action
      }

      // Special handling for "事業(TopN以外)" aggregate nodes
      if (actualNode.name.match(/^事業\(Top\d+以外.*\)$/) || actualNode.name.match(/^事業\n\(Top\d+以外.*\)$/)) {
        if (viewState.mode === 'ministry') {
          navigateToView({ projectDrilldownLevel: viewState.projectDrilldownLevel + 1 });
        } else if (viewState.mode === 'spending') {
          navigateToView({ projectDrilldownLevel: viewState.projectDrilldownLevel + 1 });
        }
        // Global view: no action for drilldown "other" nodes
        return;
      }

      if (viewState.mode === 'project') {
        // 事業ビュー: 事業一覧を開く（府省庁:すべて、事業名:選択中、支出先まとめ:維持）
        setProjectListFilters({
          ministries: undefined, // All (or should it be restricted to current ministry if selected? User said "府省庁フィルタすべて")
          projectName: actualNode.name,
          spendingName: '',
          groupByProject: undefined // Keep previous
        });
        setDialogStates(prev => ({ ...prev, projectList: true }));
      } else if (viewState.mode === 'spending') {
        // 支出ビュー: 事業ビューへ遷移
        navigateToView({ mode: 'project', selectedProject: actualNode.name });
      } else {
        // Global/Ministry View: Go to Project View (Standard behavior)
        navigateToView({ mode: 'project', selectedProject: actualNode.name });
      }
      return;
    }

    // Handle Recipient nodes
    if (actualNode.type === 'recipient') {
      // Handle "支出先(TopN)" - go back to previous spending drilldown level
      if (actualNode.id === 'recipient-top10-summary') {
        const newLevel = Math.max(0, viewState.spendingDrilldownLevel - 1);
        navigateToView({ mode: 'global', spendingDrilldownLevel: newLevel });
        return;
      }

      // Handle "その他の支出先" - drill down to next TopN spending recipients
      if (actualNode.id === 'recipient-other-aggregated') {
        const newLevel = viewState.spendingDrilldownLevel + 1;
        navigateToView({ mode: 'global', spendingDrilldownLevel: newLevel });
        return;
      }

      // Special handling for "その他"
      if (actualNode.name === 'その他') {
        navigateToView({ mode: 'spending', selectedRecipient: 'その他' });
        return;
      }

      if (viewState.mode === 'spending') {
        // 支出ビュー: 事業一覧を開く（府省庁:すべて、支出先:選択中、支出先まとめ:OFF）
        setProjectListFilters({
          ministries: undefined, // All
          projectName: '',
          spendingName: actualNode.name,
          groupByProject: false // OFF
        });
        setDialogStates(prev => ({ ...prev, projectList: true }));
      } else {
        // Other views: Go to Spending View (Standard behavior)
        navigateToView({ mode: 'spending', selectedRecipient: actualNode.name });
      }
      return;
    }

    // Handle Subcontract Recipient nodes
    if (actualNode.type === 'subcontract-recipient') {
      // Skip "再委託先(TopN以外)" aggregate nodes
      if (actualNode.name.match(/^再委託先\n\(Top\d+以外.*\)$/)) {
        return; // No action for aggregate node
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = actualNode.details as any;
      if (!details) return;

      // Global View aggregated subcontract node: build dialog data from outflows
      if (details.isGlobalSubcontractAgg && structuredData) {
        const spendingId = details.spendingId as number;
        const spendingRecord = structuredData.spendings.find(s => s.spendingId === spendingId);
        if (spendingRecord?.outflows && spendingRecord.outflows.length > 0) {
          const subcontractMap = new Map<string, { amount: number; flowTypes: Set<string> }>();
          const projectMap = new Map<number, { projectId: number; projectName: string; amount: number }>();
          const allFlowTypes = new Set<string>();

          for (const flow of spendingRecord.outflows) {
            if (flow.recipients && flow.recipients.length > 0) {
              for (const r of flow.recipients) {
                const key = r.name;
                if (!subcontractMap.has(key)) subcontractMap.set(key, { amount: 0, flowTypes: new Set() });
                const d = subcontractMap.get(key)!;
                d.amount += r.amount;
                d.flowTypes.add(flow.flowType);
                allFlowTypes.add(flow.flowType);
                if (!projectMap.has(flow.projectId)) {
                  projectMap.set(flow.projectId, { projectId: flow.projectId, projectName: flow.projectName, amount: 0 });
                }
                projectMap.get(flow.projectId)!.amount += r.amount;
              }
            } else {
              const key = flow.targetBlockName;
              if (!subcontractMap.has(key)) subcontractMap.set(key, { amount: 0, flowTypes: new Set() });
              const d = subcontractMap.get(key)!;
              d.amount += flow.amount;
              d.flowTypes.add(flow.flowType);
              allFlowTypes.add(flow.flowType);
              if (!projectMap.has(flow.projectId)) {
                projectMap.set(flow.projectId, { projectId: flow.projectId, projectName: flow.projectName, amount: 0 });
              }
              projectMap.get(flow.projectId)!.amount += flow.amount;
            }
          }

          const subcontracts = Array.from(subcontractMap.entries())
            .map(([name, d]) => ({ name, amount: d.amount, flowType: Array.from(d.flowTypes).join(', ') }))
            .sort((a, b) => b.amount - a.amount);

          setSubcontractDetail({
            name: details.sourceRecipient as string,
            sourceRecipient: details.sourceRecipient as string,
            totalAmount: actualNode.value,
            flowTypes: Array.from(allFlowTypes).join(', '),
            projects: Array.from(projectMap.values()).sort((a, b) => b.amount - a.amount),
            subcontracts,
          });
          setDialogStates(prev => ({ ...prev, subcontractDetail: true }));
        }
        return;
      }

      // Spending View individual subcontract node: find further outflows (再々委託先)
      let furtherOutflows: { name: string; amount: number; flowType: string }[] = [];
      if (structuredData) {
        const spendingRecord = structuredData.spendings.find(s => s.spendingName === actualNode.name);
        if (spendingRecord && spendingRecord.outflows) {
          // Aggregate recipients from outflows
          const recipientMap = new Map<string, { amount: number; flowTypes: Set<string> }>();

          for (const flow of spendingRecord.outflows) {
            if (flow.recipients && flow.recipients.length > 0) {
              for (const recipient of flow.recipients) {
                const key = recipient.name;
                if (!recipientMap.has(key)) {
                  recipientMap.set(key, { amount: 0, flowTypes: new Set() });
                }
                const data = recipientMap.get(key)!;
                data.amount += recipient.amount;
                data.flowTypes.add(flow.flowType);
              }
            }
          }

          furtherOutflows = Array.from(recipientMap.entries()).map(([name, data]) => ({
            name,
            amount: data.amount,
            flowType: Array.from(data.flowTypes).join(', '),
          })).sort((a, b) => b.amount - a.amount);
        }
      }

      setSubcontractDetail({
        name: actualNode.name,
        sourceRecipient: details.sourceRecipient || '',
        totalAmount: actualNode.value,
        flowTypes: details.flowTypes || '',
        projects: details.projects || [],
        furtherOutflows: furtherOutflows.length > 0 ? furtherOutflows : undefined,
      });
      setDialogStates(prev => ({ ...prev, subcontractDetail: true }));
      return;
    }
  };

  const handleReset = () => {
    navigateToView({ mode: 'global', drilldownLevel: 0 });
  };

  const handleSelectProject = (projectName: string) => {
    navigateToView({ mode: 'project', selectedProject: projectName });
  };

  const handleSelectMinistry = (ministryName: string) => {
    navigateToView({ mode: 'ministry', selectedMinistry: ministryName, projectDrilldownLevel: 0 });
  };

  const handleSelectRecipient = (recipientName: string) => {
    navigateToView({ mode: 'spending', selectedRecipient: recipientName });
  };

  const openSettings = () => {
    setTempTopNSettings(topNSettings);
    setDialogStates(prev => ({ ...prev, settings: true }));
  };

  const saveSettings = () => {
    setTopNSettings(tempTopNSettings);
    setDialogStates(prev => ({ ...prev, settings: false }));
    // Reset drilldown level and offsets if TopN changes to avoid weird states
    if (tempTopNSettings.global.ministry !== topNSettings.global.ministry) {
      setViewState(prev => ({ ...prev, drilldownLevel: 0 }));
    }
    if (tempTopNSettings.ministry.project !== topNSettings.ministry.project) {
      setViewState(prev => ({ ...prev, projectDrilldownLevel: 0 }));
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">データ読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600">エラー: {error}</p>
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

    if (viewState.mode === 'global') {
      return {
        budget: structuredData.metadata.totalBudgetAmount,
        spending: structuredData.metadata.totalSpendingAmount,
      };
    } else if (viewState.mode === 'ministry' && viewState.selectedMinistry) {
      const ministry = structuredData.budgetTree.ministries.find(m => m.name === viewState.selectedMinistry);
      const ministryBudget = ministry?.totalBudget || 0;

      // Calculate total spending for this ministry
      const ministryProjects = structuredData.budgets.filter(b => b.ministry === viewState.selectedMinistry);
      const ministrySpending = ministryProjects.reduce((sum, p) => sum + p.totalSpendingAmount, 0);

      return { budget: ministryBudget, spending: ministrySpending };
    } else if (viewState.mode === 'project' && viewState.selectedProject) {
      const project = structuredData.budgets.find(b => b.projectName === viewState.selectedProject);
      return {
        budget: project?.totalBudget || 0,
        spending: project?.totalSpendingAmount || 0,
      };
    } else if (viewState.mode === 'spending' && viewState.selectedRecipient) {
      const recipient = structuredData.spendings.find(s => s.spendingName === viewState.selectedRecipient);

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
    if (viewState.selectedMinistry && structuredData) {
      // Get total budget for selected ministry from budgetTree
      const ministry = structuredData.budgetTree.ministries.find(m => m.name === viewState.selectedMinistry);
      const ministryAmount = ministry?.totalBudget || metadata.summary.selectedBudget;

      breadcrumbs.push({
        label: viewState.selectedMinistry,
        amount: ministryAmount,
        onClick: () => {
          if (viewState.selectedMinistry) {
            navigateToView({ mode: 'ministry', selectedMinistry: viewState.selectedMinistry, projectDrilldownLevel: 0 });
          }
        },
      });
    }

    // Project level
    if (viewState.selectedProject && structuredData) {
      // Get total budget for selected project from budgets array
      const project = structuredData.budgets.find(b => b.projectName === viewState.selectedProject);
      const projectAmount = project?.totalBudget;

      breadcrumbs.push({
        label: viewState.selectedProject,
        amount: projectAmount,
        onClick: () => {
          if (viewState.selectedProject) {
            navigateToView({ mode: 'project', selectedProject: viewState.selectedProject });
          }
        },
      });
    }

    // Recipient level
    if (viewState.selectedRecipient && structuredData) {
      // Get total spending amount for selected recipient from spendings array
      const recipient = structuredData.spendings.find(s => s.spendingName === viewState.selectedRecipient);
      const recipientAmount = recipient?.totalSpendingAmount;

      breadcrumbs.push({
        label: viewState.selectedRecipient,
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
    <div className="min-h-screen bg-gray-50">
      {/* 固定ボタン */}
      <div className="fixed top-4 right-4 z-40 flex gap-2">
        <button
          onClick={() => setDialogStates(prev => ({ ...prev, projectList: true }))}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-lg"
          aria-label="事業一覧"
        >
          事業一覧
        </button>
        <button
          onClick={() => setDialogStates(prev => ({ ...prev, spendingList: true }))}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-lg"
          aria-label="支出先一覧"
        >
          支出先一覧
        </button>
        <button
          onClick={openSettings}
          className="p-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors shadow-lg"
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
        <div className="mb-3 top-0 bg-gray-50 z-30 py-2 border-b border-gray-200 shadow-sm">
          <div>
            <div className="flex items-start justify-between">
              <div>
                {/* 1行目: ビュー名 */}
                <div className="text-sm font-medium text-gray-500 mb-1">
                  {viewState.mode === 'global' && '全体'}
                  {viewState.mode === 'ministry' && '府省庁'}
                  {viewState.mode === 'project' && '事業'}
                  {viewState.mode === 'spending' && '支出先'}
                </div>

                {/* 2行目: 名称または年度 */}
                <h1 className="text-2xl font-bold text-gray-900 mb-1">
                  {viewState.mode === 'global' && structuredData && `予算年度${structuredData.metadata.fiscalYear}年`}
                  {viewState.mode === 'ministry' && viewState.selectedMinistry}
                  {viewState.mode === 'project' && viewState.selectedProject}
                  {viewState.mode === 'spending' && viewState.selectedRecipient}
                </h1>

                {/* 3行目: 予算→支出 */}
                <div className="text-lg font-semibold text-gray-700">
                  予算{formatCurrency(viewAmounts.budget)}→支出{formatCurrency(viewAmounts.spending)}
                </div>

                {/* 事業詳細パネル（事業ビューのみ） */}
                {viewState.mode === 'project' && viewState.selectedProject && structuredData && (() => {
                  const project = structuredData.budgets.find(b => b.projectName === viewState.selectedProject);
                  return project ? (
                    <ProjectDetailPanel
                      projectId={project.projectId}
                      projectName={project.projectName}
                    />
                  ) : null;
                })()}
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
                    : 'bg-white text-gray-900 hover:bg-gray-100'
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
        <div className="bg-white rounded-lg shadow-lg p-6 relative">
          {/* ノード色の凡例 + 支出先スライダー */}
          <div className="flex items-center gap-6 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#10b981]"></span>
              <span className="text-gray-700">予算</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#ef4444]"></span>
              <span className="text-gray-700">支出</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#6b7280]"></span>
              <span className="text-gray-700">その他</span>
            </div>
            {viewState.mode === 'global' && data?.metadata?.summary?.totalFilteredSpendings && (
              <div className="ml-auto w-[400px]">
                <RecipientRangeSlider
                  value={viewState.spendingDrilldownLevel * (topNSettings.global.spending || 10)}
                  total={data.metadata.summary.totalFilteredSpendings}
                  step={topNSettings.global.spending || 10}
                  onChangeCommitted={(newValue) => {
                    const newLevel = Math.floor(newValue / (topNSettings.global.spending || 10));
                    navigateToView({ mode: 'global', spendingDrilldownLevel: newLevel });
                  }}
                />
              </div>
            )}
          </div>

          {loading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

          {isMobile ? (
            <div className="mb-4 text-sm text-gray-600">
              📱 横スクロールできます
            </div>
          ) : null}

          <div
            className={isMobile ? 'overflow-x-auto' : ''}
            style={isMobile ? { WebkitOverflowScrolling: 'touch' } : {}}
          >
            <div style={{ height: '800px', minWidth: isMobile ? '1200px' : 'auto', backgroundColor: 'white' }}>
              <ResponsiveSankey
                data={sankey}
                margin={isMobile
                  ? { top: 40, right: 100, bottom: 40, left: 100 }
                  : { top: 40, right: 100, bottom: 40, left: 100 }
                }
                align={(viewState.mode === 'global' || viewState.mode === 'ministry' || viewState.mode === 'project') && sankey.nodes.some(n => n.type === 'subcontract-recipient') ? 'start' : 'justify'}
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
                    name.match(/^支出先\(Top\d+以外.*\)$/) ||
                    name.match(/^再委託先\n\(Top\d+以外.*\)$/)) {
                    return '#6b7280'; // グレー系
                  }

                  // 予算系（緑系）、支出系（赤系）
                  if (type === 'ministry-budget' || type === 'project-budget') {
                    return '#10b981'; // 緑系
                  } else if (type === 'project-spending' || type === 'recipient' || type === 'subcontract-recipient') {
                    return '#ef4444'; // 赤系（支出先・再委託先）
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
                theme={{
                  text: {
                    fill: '#1f2937',
                  },
                  tooltip: {
                    container: {
                      background: 'white',
                      color: '#1f2937',
                    },
                  },
                }}
                onClick={handleNodeClick}
                layers={[
                  'links',
                  'nodes',
                  'legends',
                  // カスタムレイヤーで2行ラベルを実現
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ({ nodes }: any) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return nodes.map((node: any) => {
                      const actualNode = sankey.nodes.find(n => n.id === node.id);
                      const name = actualNode?.name || node.id;
                      const nodeType = actualNode?.type || '';

                      // For special nodes, use actualValue from details instead of rendered node.value
                      let displayAmount = node.value;

                      // Check for actualValue in details (used for dummy-value nodes like 事業(Top10), 支出先(Top10))
                      if (actualNode?.details && 'actualValue' in actualNode.details) {
                        displayAmount = actualNode.details.actualValue as number;
                      } else if (node.value === 0.001) {
                        // For nodes with dummy value (0.001), show actual amount (0円)
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
                      if ((name.match(/^事業\(Top\d+以外.*\)$/) || name.match(/^事業\n\(Top\d+以外.*\)$/)) && viewState.mode === 'ministry') {
                        const currentEnd = (viewState.projectDrilldownLevel + 1) * topNSettings.ministry.project;
                        displayName = `事業\n(Top${currentEnd}以外)`;
                      } else if (!name.includes('\n')) {
                        // 改行を含まないラベルのみ文字数で省略
                        if (nodeType === 'project-budget') {
                          displayName = name.length > 10 ? name.substring(0, 10) + '...' : name;
                        } else if (nodeType === 'project-spending') {
                          displayName = name.length > 10 ? name.substring(0, 10) + '...' : name;
                        } else if (name.length > 10) {
                          displayName = name.substring(0, 10) + '...';
                        }
                      }

                      // Position based on node type: budget nodes on left, spending nodes on right
                      const isBudgetNode = nodeType === 'ministry-budget' || nodeType === 'project-budget';
                      const x = isBudgetNode ? node.x - 4 : node.x + node.width + 4;
                      const textAnchor = isBudgetNode ? 'end' : 'start';

                      // X position for amount label (centered above node)
                      const amountX = node.x + node.width / 2;

                      // Clickable indication
                      const nodeName = actualNode?.name || '';
                      const isProjectOtherNode = nodeName.match(/^事業\n?\(Top\d+以外.*\)$/);
                      const isGlobalView = viewState.mode === 'global';

                      const isSubcontractOtherNode = nodeName.match(/^再委託先\n\(Top\d+以外.*\)$/);
                      const isClickable =
                        node.id === 'ministry-budget-other' ||
                        node.id === 'total-budget' ||
                        node.id === 'recipient-top10-summary' ||
                        node.id === 'recipient-other-aggregated' ||
                        (nodeType === 'ministry-budget' && node.id !== 'total-budget' && node.id !== 'ministry-budget-other') ||
                        ((nodeType === 'project-budget' || nodeType === 'project-spending') && !(isProjectOtherNode && isGlobalView)) ||
                        (nodeType === 'recipient' && node.id !== 'recipient-top10-summary' && node.id !== 'recipient-other-aggregated') ||
                        (nodeType === 'subcontract-recipient' && !isSubcontractOtherNode);

                      const cursorStyle = isClickable ? 'pointer' : 'default';
                      const fontWeight = isClickable ? 'bold' : 500;
                      const color = isClickable ? '#2563eb' : '#1f2937'; // Blue if clickable (ダークモードでも同じ色)

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
                            {displayName.includes('\n') ? (
                              displayName.split('\n').map((line: string, i: number) => (
                                <tspan
                                  key={i}
                                  x={x}
                                  dy={i === 0 ? '-0.5em' : '1.2em'}
                                >
                                  {line}
                                </tspan>
                              ))
                            ) : (
                              displayName
                            )}
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

                  return (
                    <div className="bg-white px-3 py-2 rounded shadow-lg border border-gray-200 min-w-[280px]">
                      <div className="font-bold text-gray-900 mb-1">
                        {name}
                      </div>
                      <div className="text-sm text-gray-600">
                        金額: {value}
                      </div>
                      {details && (
                        <div className="text-xs text-gray-500 mt-1 space-y-0.5">
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

                          {/* タグ情報（支出先・再委託先） */}
                          {details.tags && (
                            <div className="mt-1 pt-1 border-t border-gray-300">
                              <div className="flex flex-wrap gap-1 items-center">
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                                  {details.tags.secondaryCategory}
                                </span>
                                <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs font-medium">
                                  {details.tags.primaryIndustryTag}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* 再委託先ノード */}
                          {nodeType === 'subcontract-recipient' && details.sourceRecipient && (
                            <div className="mt-1 pt-1 border-t border-gray-300">
                              <div className="font-semibold">委託元: {details.sourceRecipient}</div>
                              {details.flowTypes && (
                                <div>資金の流れ: {details.flowTypes}</div>
                              )}
                              {details.projects && details.projects.length > 0 && (
                                <div className="mt-1">
                                  <div className="font-semibold">関連事業:</div>
                                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                  {details.projects.slice(0, 5).map((proj: any, idx: number) => (
                                    <div key={idx} className="ml-2">
                                      • {proj.projectName}: {formatCurrency(proj.amount)}
                                    </div>
                                  ))}
                                  {details.projects.length > 5 && (
                                    <div className="ml-2 text-gray-400">
                                      ... 他{details.projects.length - 5}事業
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
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
                    <div className="bg-white px-4 py-3 rounded shadow-lg border border-gray-200 min-w-[280px] max-w-md">
                      {/* タイトル */}
                      <div className="text-sm font-bold text-gray-900 mb-2 border-b border-gray-200 pb-2">
                        {title}
                      </div>

                      {/* 送信元 */}
                      <div className="mb-2">
                        {isProjectBudgetToSpending && (
                          <div className="text-xs text-gray-500">{sourceLabel}</div>
                        )}
                        {!isProjectBudgetToSpending && (
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {sourceName}
                          </div>
                        )}
                        <div className="text-sm font-medium text-gray-700">
                          {sourceValue}
                        </div>
                      </div>

                      {/* 矢印と流れる金額 */}
                      <div className="text-center my-2">
                        <div className="text-sm font-bold text-gray-900">
                          ↓ {linkValue}
                        </div>
                      </div>

                      {/* 送信先 */}
                      <div className="mb-2">
                        {isProjectBudgetToSpending && (
                          <div className="text-xs text-gray-500">{targetLabel}</div>
                        )}
                        {!isProjectBudgetToSpending && (
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {targetName}
                          </div>
                        )}
                        <div className="text-sm font-medium text-gray-700">
                          {targetValue}
                        </div>
                      </div>

                      {/* リンク詳細情報 */}
                      {actualLink?.details && (actualLink.details.contractMethod || actualLink.details.blockName) && (
                        <div className="mt-3 pt-2 border-t border-gray-200">
                          {actualLink.details.contractMethod && (
                            <div className="mb-1">
                              <span className="text-xs text-gray-500">契約方式: </span>
                              <span className="text-xs font-medium text-gray-900">
                                {actualLink.details.contractMethod}
                              </span>
                            </div>
                          )}
                          {actualLink.details.blockName && (
                            <div>
                              <span className="text-xs text-gray-500">支出ブロック: </span>
                              <span className="text-xs font-medium text-gray-900">
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
          {viewState.mode === 'global' && (
            <div className="mb-4 flex items-center gap-2">
              <label htmlFor="topn-selector" className="text-sm font-medium text-gray-700">
                府省庁Top
              </label>
              <button
                onClick={() => {
                  if (viewState.drilldownLevel > 0) {
                    const newLevel = viewState.drilldownLevel - 1;
                    setViewState(prev => ({ ...prev, drilldownLevel: newLevel }));
                  }
                }}
                disabled={viewState.drilldownLevel === 0}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="前のTopNへ"
              >
                ▲
              </button>
              <select
                id="topn-selector"
                value={viewState.drilldownLevel}
                onChange={(e) => {
                  const newLevel = parseInt(e.target.value);
                  setViewState(prev => ({ ...prev, drilldownLevel: newLevel }));
                }}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(() => {
                  const totalMinistries = metadata.summary.totalMinistries || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalMinistries / topNSettings.global.ministry) - 1);
                  return Array.from({ length: maxLevel + 1 }, (_, i) => {
                    const level = i;
                    const startNum = level * topNSettings.global.ministry + 1;
                    const endNum = Math.min((level + 1) * topNSettings.global.ministry, totalMinistries);
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
                  const maxLevel = Math.max(0, Math.ceil(totalMinistries / topNSettings.global.ministry) - 1);
                  if (viewState.drilldownLevel < maxLevel) {
                    const newLevel = viewState.drilldownLevel + 1;
                    setViewState(prev => ({ ...prev, drilldownLevel: newLevel }));
                  }
                }}
                disabled={(() => {
                  const totalMinistries = metadata.summary.totalMinistries || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalMinistries / topNSettings.global.ministry) - 1);
                  return viewState.drilldownLevel >= maxLevel;
                })()}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="次のTopNへ"
              >
                ▼
              </button>
              <span className="text-sm text-gray-700">へ</span>
            </div>
          )}

          {/* Ministry View: Project TopN Selector */}
          {viewState.mode === 'ministry' && metadata.summary.ministryTotalProjects && metadata.summary.ministryTotalProjects > topNSettings.ministry.project && (
            <div className="mb-4 flex items-center gap-2">
              <label htmlFor="project-topn-selector" className="text-sm font-medium text-gray-700">
                事業Top
              </label>
              <button
                onClick={() => {
                  if (viewState.projectDrilldownLevel > 0) {
                    setViewState(prev => ({ ...prev, projectDrilldownLevel: prev.projectDrilldownLevel - 1 }));
                  }
                }}
                disabled={viewState.projectDrilldownLevel === 0}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="前のTopNへ"
              >
                ▲
              </button>
              <select
                id="project-topn-selector"
                value={viewState.projectDrilldownLevel}
                onChange={(e) => {
                  const newLevel = parseInt(e.target.value);
                  setViewState(prev => ({ ...prev, projectDrilldownLevel: newLevel }));
                }}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(() => {
                  const totalProjects = metadata.summary.ministryTotalProjects || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalProjects / topNSettings.ministry.project) - 1);
                  return Array.from({ length: maxLevel + 1 }, (_, i) => {
                    const level = i;
                    const startNum = level * topNSettings.ministry.project + 1;
                    const endNum = Math.min((level + 1) * topNSettings.ministry.project, totalProjects);
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
                  const maxLevel = Math.max(0, Math.ceil(totalProjects / topNSettings.ministry.project) - 1);
                  if (viewState.projectDrilldownLevel < maxLevel) {
                    setViewState(prev => ({ ...prev, projectDrilldownLevel: prev.projectDrilldownLevel + 1 }));
                  }
                }}
                disabled={(() => {
                  const totalProjects = metadata.summary.ministryTotalProjects || 0;
                  const maxLevel = Math.max(0, Math.ceil(totalProjects / topNSettings.ministry.project) - 1);
                  return viewState.projectDrilldownLevel >= maxLevel;
                })()}
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="次のTopNへ"
              >
                ▼
              </button>
              <span className="text-sm text-gray-700">へ</span>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>生成日時: {new Date(metadata.generatedAt).toLocaleString('ja-JP')}</p>
          <p className="mt-2">
            データソース:{' '}
            <a
              href="https://rssystem.go.jp/download-csv/2024"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600"
            >
              行政事業レビューシステム
            </a>
          </p>
        </div>
      </div>

      {/* 設定ダイアログ */}
      {dialogStates.settings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDialogStates(prev => ({ ...prev, settings: false }))}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setDialogStates(prev => ({ ...prev, settings: false }))}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ✕
            </button>
            <h2 className="text-xl font-bold mb-6 text-gray-900">TopN表示設定</h2>

            {/* 全体ビュー */}
            <div className="mb-6 p-4 border border-gray-200 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800">全体ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    府省庁TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempTopNSettings.global.ministry}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, global: { ...prev.global, ministry: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    支出先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempTopNSettings.global.spending}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, global: { ...prev.global, spending: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    再委託先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={tempTopNSettings.global.subcontract}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, global: { ...prev.global, subcontract: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 5</p>
                </div>
              </div>
            </div>

            {/* 府省庁ビュー */}
            <div className="mb-6 p-4 border border-gray-200 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800">府省庁ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    事業TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempTopNSettings.ministry.project}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, ministry: { ...prev.ministry, project: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    支出先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempTopNSettings.ministry.spending}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, ministry: { ...prev.ministry, spending: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
              </div>
            </div>

            {/* 事業ビュー */}
            <div className="mb-6 p-4 border border-gray-200 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800">事業ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    支出先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempTopNSettings.project.spending}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, project: { ...prev.project, spending: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 20</p>
                </div>
              </div>
            </div>

            {/* 支出ビュー */}
            <div className="mb-6 p-4 border border-gray-200 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-gray-800">支出ビュー</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    支出元事業TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempTopNSettings.spending.project}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, spending: { ...prev.spending, project: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 15</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    支出元府省庁TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={tempTopNSettings.spending.ministry}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, spending: { ...prev.spending, ministry: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 10</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    再委託先TopN
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tempTopNSettings.spending.subcontract}
                    onChange={(e) => setTempTopNSettings(prev => ({ ...prev, spending: { ...prev.spending, subcontract: parseInt(e.target.value) || 1 } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">デフォルト: 20</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDialogStates(prev => ({ ...prev, settings: false }))}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
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
        isOpen={dialogStates.projectList}
        onClose={() => {
          setDialogStates(prev => ({ ...prev, projectList: false }));
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
        isOpen={dialogStates.spendingList}
        onClose={() => setDialogStates(prev => ({ ...prev, spendingList: false }))}
        onSelectRecipient={handleSelectRecipient}
        onSelectMinistry={handleSelectMinistry}
        onSelectProject={handleSelectProject}
        initialFilters={spendingListFilters}
      />

      {/* 再委託先詳細ダイアログ */}
      <SubcontractDetailDialog
        isOpen={dialogStates.subcontractDetail}
        onClose={() => setDialogStates(prev => ({ ...prev, subcontractDetail: false }))}
        detail={subcontractDetail}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

export default function SankeyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    }>
      <SankeyContent />
    </Suspense>
  );
}
