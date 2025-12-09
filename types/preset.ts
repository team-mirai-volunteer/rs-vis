/**
 * RS2024プリセットJSONデータの型定義
 */

// トップレベル構造
export interface RS2024PresetData {
  metadata: PresetMetadata;
  sankey: SankeyData;
}

// プリセットメタデータ
export interface PresetMetadata {
  generatedAt: string;           // ISO 8601形式の生成日時
  fiscalYear: number;             // 会計年度（2024）
  presetType: string;             // プリセットタイプ（例: "top3", "top5"）
  sourceFile: string;             // 元データファイル名

  // フィルタリング設定
  filterSettings: {
    topMinistries: number;        // 府省庁のTop件数
    topProjects: number;          // 事業のTop件数
    topSpendings: number;         // 支出先のTop件数
    sortBy: 'budget' | 'spending'; // ソート基準
  };

  // 統計サマリ
  summary: {
    totalMinistries: number;      // 元データの総府省庁数
    totalProjects: number;         // 元データの総事業数
    totalSpendings: number;        // 元データの総支出先数
    selectedMinistries: number;    // 選択された府省庁数
    selectedProjects: number;      // 選択された事業数
    selectedSpendings: number;     // 選択された支出先数
    totalBudget: number;           // 元データの総予算額
    selectedBudget: number;        // 選択されたデータの総予算額
    coverageRate: number;          // カバー率（%、0-100）
    ministryTotalProjects?: number; // 府省庁ビュー: 選択した府省庁の総事業数
  };
}

// サンキーデータ
export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

// サンキーノード
export interface SankeyNode {
  id: string;                     // ノードの一意識別子
  name: string;                   // ノード表示名
  type: 'ministry-budget' | 'project-budget' | 'project-spending' | 'recipient' | 'other';  // ノードタイプ
  value: number;                  // ノードの値（予算額または支出額、円）

  // 元データへの参照
  originalId?: number;            // 元データのID（ministryId, projectId, spendingId）

  // 追加情報（ツールチップ等で使用）
  details?: MinistryNodeDetails | ProjectBudgetNodeDetails | ProjectSpendingNodeDetails | RecipientNodeDetails;
}

// 府省庁ノードの詳細
export interface MinistryNodeDetails {
  projectCount: number;           // 事業数
  bureauCount: number;            // 局・庁数
}

// 事業（予算）ノードの詳細
export interface ProjectBudgetNodeDetails {
  ministry: string;               // 所属府省庁
  bureau: string;                 // 所属局・庁
  fiscalYear: number;             // 会計年度
  initialBudget: number;          // 当初予算(合計)
  supplementaryBudget: number;    // 補正予算(合計)
  carryoverBudget: number;        // 前年度からの繰越し(合計)
  reserveFund: number;            // 予備費等(合計)
  totalBudget: number;            // 計(歳出予算現額合計)
  executedAmount: number;         // 執行額(合計)
  carryoverToNext: number;        // 翌年度への繰越し(合計)
  accountCategory: string;        // 会計区分（一般会計、特別会計）
}

// 事業（支出）ノードの詳細
export interface ProjectSpendingNodeDetails {
  ministry: string;               // 所属府省庁
  bureau: string;                 // 所属局・庁
  fiscalYear: number;             // 会計年度
  executionRate: number;          // 執行率（%）
  spendingCount: number;          // 支出先数
}

// 支出先ノードの詳細
export interface RecipientNodeDetails {
  corporateNumber: string;        // 法人番号
  location: string;               // 所在地
  projectCount: number;           // 支出元事業数
}

// サンキーリンク
export interface SankeyLink {
  source: string;                 // 送信元ノードID
  target: string;                 // 送信先ノードID
  value: number;                  // リンクの値（金額、円）

  // 追加情報（ツールチップ等で使用）
  details?: {
    contractMethod?: string;      // 契約方式
    blockName?: string;           // 支出先ブロック名
  };
}
