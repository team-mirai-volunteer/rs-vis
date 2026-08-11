/**
 * SankeyQuery — /sankey-svg のフィルタ・表示状態を表す構造化クエリ。
 *
 * UIフィルタパネル状態・URLパラメータ・/api/sankey/query の3者がこの型を共有する。
 * 全金額は1円単位（UIの「億円」テキスト入力との換算は変換層が担う）。
 * 全フィールド optional。省略時の既定値は /sankey-svg の初期状態と一致する
 * （app/lib/sankey-query.ts の resolveSankeyQuery が補完する）。
 */

export interface SankeyNameFilter {
  /** 検索文字列。regex=false のときは大文字小文字を無視した部分一致 */
  query: string;
  /** true なら query を正規表現（フラグ i）として解釈 */
  regex?: boolean;
  /**
   * recipientName のみ有効: true なら再委託先名にもマッチさせる（直接支出先 OR 再委託先）。
   * このとき判定は事業単位（支出先ノード自体は隠さない — 再委託側だけがマッチした事業の
   * 支出先が全滅してカスケード除外されるのを防ぐため）
   */
  includeSubcontract?: boolean;
}

export interface SankeyAmountRange {
  /** 下限（1円単位）。null/省略 = 無制限 */
  min?: number | null;
  /** 上限（1円単位）。null/省略 = 無制限 */
  max?: number | null;
}

/** 会計区分。'none' = 会計区分情報なしの事業 */
export type AccountCategoryKey = 'general' | 'special' | 'both' | 'none';

/**
 * 再委託条件（Issue #270）。グラフの project ノードに埋め込まれた
 * ブロック階層数（subcontractDepth。1=直接支出のみ・2以上=再委託あり）で判定する
 */
export interface SankeySubcontractFilter {
  /** true = 再委託の記載がある事業（階層2以上）のみ残す */
  hasRedelegation?: boolean;
  /** ブロック階層数の下限（2=再委託あり、3=再々委託以深…）。指定時は記載なし事業を除外 */
  minDepth?: number | null;
}

/** プレフィルタ条件（どのノードを残すか）。条件は AND で結合される */
export interface SankeyQueryFilter {
  projectName?: SankeyNameFilter;
  recipientName?: SankeyNameFilter;
  /** 府省庁名の完全一致リスト（いずれかに一致すれば残す） */
  ministries?: string[];
  /** 事業予算額の範囲 */
  budget?: SankeyAmountRange;
  /** 支出先の受領額の範囲 */
  spending?: SankeyAmountRange;
  /** 含める会計区分。省略 or 全4種指定 = フィルタなし */
  accountCategories?: AccountCategoryKey[];
  /** 再委託条件。省略 = フィルタなし */
  subcontract?: SankeySubcontractFilter;
}

/** 表示条件（TopN集約・ピン・フォーカス等、どう見せるか） */
export interface SankeyQueryView {
  topMinistry?: number;
  topProject?: number;
  topRecipient?: number;
  pin?: {
    /** project-spending ノードID（例: "project-spending-5297"） */
    projectId?: string | null;
    /** recipient ノードID（例: "r-国立研究開発法人..."） */
    recipientId?: string | null;
    ministryName?: string | null;
  };
  /** ピンしたノードの関連のみ表示 */
  focusRelated?: boolean;
  offset?: {
    target?: 'recipient' | 'project';
    recipient?: number;
    project?: number;
  };
  projectSortBy?: 'budget' | 'spending';
  showAggProject?: boolean;
  showAggRecipient?: boolean;
  scaleBudgetToVisible?: boolean;
}

export interface SankeyQuery {
  year?: '2024' | '2025';
  filter?: SankeyQueryFilter;
  view?: SankeyQueryView;
}

/** resolveSankeyQuery による既定値補完・クランプ後の確定形 */
export interface ResolvedSankeyQuery {
  year: '2024' | '2025';
  filter: {
    projectName: SankeyNameFilter | null;
    recipientName: SankeyNameFilter | null;
    ministries: string[];
    budget: { min: number | null; max: number | null };
    spending: { min: number | null; max: number | null };
    accountCategories: AccountCategoryKey[];
    subcontract: { hasRedelegation: boolean; minDepth: number | null };
  };
  view: {
    topMinistry: number;
    topProject: number;
    topRecipient: number;
    pin: { projectId: string | null; recipientId: string | null; ministryName: string | null };
    focusRelated: boolean;
    offset: { target: 'recipient' | 'project'; recipient: number; project: number };
    projectSortBy: 'budget' | 'spending';
    showAggProject: boolean;
    showAggRecipient: boolean;
    scaleBudgetToVisible: boolean;
  };
}
