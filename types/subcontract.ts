export interface RecipientExpense {
  category: string;
  purpose: string;
  amount: number;
}

export interface BlockRecipient {
  name: string;
  corporateNumber: string;
  amount: number;
  contractSummaries: string[];
  expenses: RecipientExpense[];
}

export type BlockOriginKind =
  | 'direct'
  | 'subcontract'
  | 'separate-origin-broad'
  | 'separate-origin-strong';

export interface BlockNode {
  blockId: string;
  blockName: string;
  totalAmount: number;
  /** 担当組織からの直接支出ブロックか（既存互換のため残す。`originKind === 'direct'` と等価） */
  isDirect: boolean;
  /** 起点種別（5-2 のグラフ構造から判定） */
  originKind: BlockOriginKind;
  /** 下流ブロックを持たないリーフ */
  isTerminal: boolean;
  recipientCount: number;
  hasExpenses: boolean;
  role?: string;
  recipients: BlockRecipient[];
}

export type FlowOrigin =
  | 'direct'
  | 'transfer'
  | 'separate-origin'
  | 'subcontract'
  | 'reference';

export interface BlockEdge {
  sourceBlock: string | null;
  targetBlock: string;
  note?: string;
  origin: FlowOrigin;
  /** `参考` を補足情報に含むフロー */
  isReference: boolean;
  /** target ブロックに流入する支出元ブロック数（合流の太さ） */
  targetIncomingBlockCount: number;
}

export interface IndirectCost {
  /** 旧 `支出元の支出先ブロック名` 等の参考表記 */
  blockHint: string;
  /** 「国自らが支出する間接経費」列の分類テキスト（`間接経費` `職員旅費` `事務費` など） */
  kind: string;
  /** 国自らが支出する間接経費の項目 */
  category: string;
  amount: number;
  note?: string;
}

export interface SubcontractGraph {
  projectId: number;
  projectName: string;
  ministry: string;
  /** 局・庁 / 部 / 課 を ' / ' で連結した担当組織。空欄は除く */
  bureau: string;
  /** '一般会計' | '特別会計' | '一般会計+特別会計' | '' */
  accountCategory: string;
  /** 2-1 サマリ: 計(歳出予算現額合計) */
  budget: number;
  /** 2-1 サマリ: 執行額(合計) */
  execution: number;
  /** 5-1 の direct ブロック totalAmount 合計（直接支出ブロックへの事業からの支出） */
  directExpenseTotal: number;
  /** 5-1 の全ブロック totalAmount 合計（事業内のブロック支出の総和。再委託も含む） */
  totalExpense: number;
  blocks: BlockNode[];
  flows: BlockEdge[];
  maxDepth: number;
  directBlockCount: number;
  totalBlockCount: number;
  totalRecipientCount: number;
  indirectCosts: IndirectCost[];
  /** 別起点ブロック（広め）が1つ以上あるか */
  hasSeparateOrigin: boolean;
  separateOriginCount: number;
  strongSeparateOriginCount: number;
  separateOriginAmount: number;
  hasMerge: boolean;
  mergeTargetCount: number;
  maxMergeWidth: number;
  /** 1ブロックから複数下流ブロックを持つ「分岐元」の件数 */
  branchingBlockCount: number;
  /** 1ブロックから出る最大分岐幅 */
  maxBranchWidth: number;
  hasReferenceFlow: boolean;
  /** 全ブロックが totalAmount=0 かつ recipients=0 の制度フロー */
  isInstitutionalFlowOnly: boolean;
}

export type SubcontractIndex = Record<string, SubcontractGraph>;
