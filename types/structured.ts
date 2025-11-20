/**
 * RS2024構造化JSONデータの型定義
 */

// トップレベル構造
export interface RS2024StructuredData {
  metadata: Metadata;
  budgetTree: BudgetTree;
  budgets: BudgetRecord[];              // 2024年度の予算レコード
  spendings: SpendingRecord[];
  statistics: Statistics;
  historicalBudgets: BudgetRecord[];    // 過去年度（2023年度以前）の予算レコード
}

// メタデータ
export interface Metadata {
  generatedAt: string;           // ISO 8601形式の生成日時
  fiscalYear: number;             // 会計年度（2024）
  dataVersion: string;            // データバージョン
  totalProjects: number;          // 総事業数
  totalRecipients: number;        // 総支出先数
  totalBudgetAmount: number;      // 総予算額（円）
  totalSpendingAmount: number;    // 総支出額（円）
}

// 予算ツリー
export interface BudgetTree {
  totalBudget: number;
  ministries: MinistryNode[];
}

export interface MinistryNode {
  id: number;
  name: string;
  totalBudget: number;
  bureaus: BureauNode[];
  projectIds: number[];
}

export interface BureauNode {
  id: number;
  name: string;
  totalBudget: number;
  departments: DepartmentNode[];
  projectIds: number[];
}

export interface DepartmentNode {
  id: number;
  name: string;
  totalBudget: number;
  divisions: DivisionNode[];
  projectIds: number[];
}

export interface DivisionNode {
  id: number;
  name: string;
  totalBudget: number;
  offices: OfficeNode[];
  projectIds: number[];
}

export interface OfficeNode {
  id: number;
  name: string;
  totalBudget: number;
  groups: GroupNode[];
  projectIds: number[];
}

export interface GroupNode {
  id: number;
  name: string;
  totalBudget: number;
  sections: SectionNode[];
  projectIds: number[];
}

export interface SectionNode {
  id: number;
  name: string;
  totalBudget: number;
  projectIds: number[];
}

// 予算レコード
export interface BudgetRecord {
  // 基本情報
  projectId: number;
  projectName: string;
  fiscalYear: number;
  projectStartYear: number;
  projectEndYear: number;

  // 組織情報
  ministry: string;
  bureau: string;
  department: string;
  division: string;
  office: string;
  group: string;
  section: string;
  hierarchyPath: string[];

  // 予算情報（円単位）
  initialBudget: number;
  supplementaryBudget: number;
  carryoverBudget: number;
  reserveFund: number;
  totalBudget: number;

  // 執行情報（円単位）
  executedAmount: number;
  executionRate: number;
  carryoverToNext: number;
  nextYearRequest: number;

  // 会計情報
  accountCategory: string;
  account: string;
  accountingSubdivision: string;

  // 支出先情報
  spendingIds: number[];
  totalSpendingAmount: number;
}

// 支出レコード
export interface SpendingRecord {
  // 基本情報
  spendingId: number;
  spendingName: string;

  // 法人情報
  corporateNumber: string;
  location: string;
  corporateType: string;

  // 支出情報
  totalSpendingAmount: number;
  projectCount: number;
  projects: SpendingProject[];
}

export interface SpendingProject {
  projectId: number;
  amount: number;
  blockNumber: string;
  blockName: string;
  contractSummary: string;
  contractMethod: string;
}

// 統計情報
export interface Statistics {
  byMinistry: {
    [ministryName: string]: {
      projectCount: number;
      totalBudget: number;
      totalSpending: number;
      recipientCount: number;
    };
  };

  topSpendingsByAmount: {
    spendingId: number;
    spendingName: string;
    totalSpendingAmount: number;
    projectCount: number;
  }[];

  topProjectsByBudget: {
    projectId: number;
    projectName: string;
    ministry: string;
    totalBudget: number;
  }[];

  topProjectsBySpending: {
    projectId: number;
    projectName: string;
    ministry: string;
    totalSpendingAmount: number;
  }[];
}
