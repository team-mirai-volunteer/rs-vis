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

// 支出ブロック間のフロー情報
export interface SpendingBlockFlow {
  projectId: number;                // 事業ID
  projectName: string;              // 事業名
  sourceBlockNumber: string;        // 支出元ブロック番号（例: "A"）
  sourceBlockName: string;          // 支出元ブロック名（例: "株式会社博報堂"）
  targetBlockNumber: string;        // 支出先ブロック番号（例: "B"）
  targetBlockName: string;          // 支出先ブロック名（例: "東京電力EP等"）
  flowType: string;                 // 資金の流れの種類（例: "間接補助金"）
  amount: number;                   // 金額（円）
  recipients?: {                    // ブロック内の個別支出先
    name: string;                   // 支出先名
    corporateNumber: string;        // 法人番号
    amount: number;                 // 支出額（円）
  }[];
  isDirectFromGov: boolean;         // 担当組織からの直接支出か
}

/**
 * エンティティ種別（entity-normalization.json 辞書による分類）
 */
export type EntityType =
  | '民間企業'
  | '地方公共団体'
  | '国の機関'
  | '独立行政法人'
  | '公益法人・NPO'
  | '外国法人'
  | 'その他';

// 支出レコード
export interface SpendingRecord {
  // 基本情報
  spendingId: number;
  spendingName: string;

  // 正規化表示名（entity-normalization.json 辞書から。未登録の場合は省略→spendingName にフォールバック）
  displayName?: string;

  // エンティティ種別（辞書による分類）
  entityType?: EntityType;

  // 親会社の displayName（支店・支社の場合のみ）
  parentName?: string;

  // 法人情報
  corporateNumber: string;
  location: string;
  corporateType: string;

  // 支出情報
  totalSpendingAmount: number;
  projectCount: number;
  projects: SpendingProject[];

  // 再委託情報（5-2 CSVから）
  outflows?: SpendingBlockFlow[];   // この支出先から他への支出
  inflows?: SpendingBlockFlow[];    // この支出先への流入（親支出先から）

  // タグ情報（自動分類）
  tags?: SpendingTags;
}

export interface SpendingProject {
  projectId: number;
  amount: number;
  blockNumber: string;
  blockName: string;
  contractSummary: string;
  contractMethod: string;
  isDirectFromGov?: boolean;    // 政府から直接支出か（falseなら委託経由）
  sourceChainPath?: string;    // 委託元チェーンパス（例: "博報堂 → EYストラテジー"、間接支出の場合のみ）
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

// ========================================
// MOF財源データ
// ========================================

/**
 * 財源の種類
 */
export type FundingSourceType =
  | '租税'           // 所得税、法人税、消費税等
  | '公債金'         // 国債発行による収入
  | '保険料'         // 社会保険料（年金、医療、雇用等）
  | '一般会計繰入'   // 一般会計から特別会計への繰入（税金由来）
  | 'その他';        // 国有財産収入、諸収入等

/**
 * 財源構成
 */
export interface FundingSources {
  /** 租税（所得税、法人税、消費税等）- 円単位 */
  taxRevenue: number;
  /** 公債金（新規国債） - 円単位 */
  publicBonds: number;
  /** 社会保険料 - 円単位 */
  insurancePremiums: number;
  /** 一般会計繰入（税金由来） - 円単位 */
  transferFromGeneral: number;
  /** その他（国有財産収入等） - 円単位 */
  other: number;
  /** 合計 - 円単位 */
  total: number;
}

/**
 * 特別会計の財源情報
 */
export interface SpecialAccountFunding {
  /** 特別会計名 */
  specialAccountName: string;
  /** 勘定名（厚生年金勘定、国民年金勘定等） */
  accountingName?: string;
  /** 所管（内閣府及び厚生労働省等） */
  jurisdiction: string;
  /** 財源構成 */
  fundingSources: FundingSources;
}

/**
 * 府省庁の財源情報
 */
export interface MinistryFunding {
  /** 府省庁名 */
  ministryName: string;
  /** 一般会計（税金ベース）の財源構成 */
  generalAccount: FundingSources;
  /** 特別会計の財源構成（該当する場合） */
  specialAccounts: SpecialAccountFunding[];
  /** 合計財源構成 */
  totalFunding: FundingSources;
}

/**
 * MOF財源データ全体
 */
export interface MOFFundingData {
  /** データ生成日時 */
  generatedAt: string;
  /** 会計年度 */
  fiscalYear: number;
  /** データ種別（予算/決算） */
  dataType: 'budget' | 'settlement';
  /** 一般会計の財源構成 */
  generalAccountTotal: FundingSources;
  /** 特別会計への一般会計繰入 */
  transfersToSpecialAccounts: {
    /** 特別会計名 */
    specialAccountName: string;
    /** 繰入額（円） */
    amount: number;
  }[];
  /** 特別会計別の財源情報 */
  specialAccountFundings: SpecialAccountFunding[];
  /** 府省庁別の財源情報 */
  ministryFundings: MinistryFunding[];
}

// ========================================
// タグ付け体系
// ========================================

/**
 * 組織種別の大分類（Primary Category）
 */
export type PrimaryCategory = 'government' | 'private' | 'public-interest' | 'individual-other';

/**
 * 業種タグ
 */
export type IndustryTag =
  | 'ITシステム・保守'
  | '防衛・装備'
  | '建設・土木'
  | 'コンサルティング'
  | '事務局・BPR'
  | '教育・研究'
  | '医療・保険'
  | 'エネルギー'
  | '金融'
  | '物流・運輸'
  | '印刷・広告'
  | '農林水産'
  | '製造'
  | 'その他';

/**
 * ベンダーロックインリスク評価レベル
 */
export type LockInRisk = 'critical' | 'warning' | 'monitor' | 'strategic';

/**
 * 支出先タグ情報
 */
export interface SpendingTags {
  /** 大分類（自動判定） */
  primaryCategory: PrimaryCategory;

  /** 中分類（自動判定） */
  secondaryCategory: string;

  /** 主要業種（UIのバッジ表示用） */
  primaryIndustryTag: IndustryTag;

  /** 全業種タグ（詳細表示用） */
  industryTags: IndustryTag[];

  /** ベンダーロックインリスク評価（分析結果） */
  lockInRisk?: LockInRisk;

  /** リスク評価の根拠 */
  lockInRiskReason?: string;
}
