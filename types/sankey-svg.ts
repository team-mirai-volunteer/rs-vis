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
  /**
   * 再委託ブロック階層数 — project-budget ノードのみ、かつ2以上（再委託あり）の場合のみ付与。
   * subcontracts-{year}.json の maxDepth 由来（2=再委託、3=再々委託…）。
   * 未設定 = 再委託の記載なし（直接支出のみ）。フィルタ（filter.subcontract）が使う
   */
  subcontractDepth?: number;
  /**
   * 再委託ブロックの支出先名一覧 — project-budget ノードのみ・再委託ありの場合のみ付与。
   * filter.subcontract.recipientName（再委託先名フィルタ）が参照する
   */
  subcontractRecipients?: string[];
  /** 予算・執行サマリ — project-budget ノードのみ付与 */
  budgetSummary?: BudgetSummary;
  /** 会計区分・歳出項目ごとの予算内訳 — project-budget ノードのみ付与 */
  budgetBreakdown?: BudgetBreakdownItem[];
  /**
   * 代表法人番号 — recipient ノードのみ。名前集約されたノードが内包する
   * 有効法人番号のうち最大金額のもの。内包が0件（集約行・法人番号なし）の場合は未設定。
   */
  representativeCorporateNumber?: string;
  /**
   * このノードが内包する相異なる有効法人番号の件数 — recipient ノードのみ。
   * 2以上なら名前集約が複数実体（誤記載分裂含む）にまたがることを示す（サイドパネルで「他N件」表示）。
   */
  corporateNumberCount?: number;
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
