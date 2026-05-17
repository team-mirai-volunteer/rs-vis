export interface RawNode {
  id: string;
  name: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  value: number;
  /** Actual value preserved when layout height is capped (used for tooltip display) */
  rawValue?: number;
  /** True when a budget node's height has been scaled by visible spending fraction */
  isScaled?: boolean;
  /** If set, layout engine uses this value as the column sort key instead of value */
  layoutSortValue?: number;
  /** If set, layout engine uses this value for spacing/gap (node bounds still use value) */
  layoutHeight?: number;
  /** If set, layout engine caps node height to this value after computing link-sum */
  layoutCap?: number;
  /** If true, layout engine skips the link-sum override so node.value stays as initialized */
  skipLinkOverride?: boolean;
  aggregated?: boolean;
  projectId?: number;
  ministry?: string;
  /** 会計区分 — project-budget ノードのみ付与 */
  accountCategory?: 'general' | 'special' | 'both';
  /** 予算・執行サマリ — project-budget ノードのみ付与 */
  budgetSummary?: BudgetSummary;
  /** 会計区分・歳出項目ごとの予算内訳 — project-budget ノードのみ付与 */
  budgetBreakdown?: BudgetBreakdownItem[];
}

export interface BudgetSummary {
  fiscalYear: number;
  initialBudget: number;
  supplementaryBudget: number;
  carryoverBudget: number;
  reserveFund: number;
  totalBudget: number;
  executedAmount: number;
  executionRate: number | null;
  carryoverToNext: number;
  nextYearRequest: number;
  accountSummaries: BudgetAccountSummary[];
}

export interface BudgetAccountSummary {
  accountCategory: string;
  totalBudget: number;
  executedAmount: number;
}

export interface BudgetBreakdownItem {
  fiscalYear: number;
  accountCategory: string;
  account: string;
  subAccount: string;
  budgetType: string;
  jurisdiction: string;
  organizationAccount: string;
  item: string;
  subItem: string;
  note: string;
  amount: number;
  nextYearRequestAmount: number;
}

export interface RawEdge {
  source: string;
  target: string;
  value: number;
}

export interface GraphData {
  metadata: {
    totalBudget: number;
    totalSpending: number;
    directSpending: number;
    indirectSpending: number;
    ministryCount: number;
    projectCount: number;
    recipientCount: number;
  };
  nodes: RawNode[];
  edges: RawEdge[];
}

export interface LayoutNode extends RawNode {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sourceLinks: LayoutLink[];
  targetLinks: LayoutLink[];
}

export interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  value: number;
  sourceWidth: number;
  targetWidth: number;
  y0: number;
  y1: number;
}
