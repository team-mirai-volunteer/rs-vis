/**
 * MOF 予算全体ビューの型定義。
 *
 * 生成物（`public/data/mof-budget-overview-{YEAR}.json`）は**集計値だけ**を持ち、
 * サンキー図の形は持たない。可視化の都合でデータを作り直さずに済むよう分離している。
 * ノード・リンクの組み立ては `app/lib/mof-sankey-generator.ts` の責務。
 *
 * 捕捉ロジックの根拠は docs/mof-budget-data-guide.md 6節（実測で確定）。
 */

import type { SankeyNode, SankeyLink } from './sankey';

/** 会計区分 */
export type MOFAccountKind = 'general' | 'special' | 'agency';

/** 名前と金額の組。款別・税目別・宛先別などの内訳に使う */
export interface MOFAmountGroup {
  name: string;
  /** 金額（円） */
  amount: number;
}

/** 歳出の内訳。他会計への繰入と、それ以外の実支出に分ける */
export interface MOFExpenditureBreakdown {
  /** 歳出合計（円） */
  total: number;
  /** 他会計へ繰入（使途別分類コード = 6）。会計をまたぐと二重計上になる分 */
  transferOut: number;
  /** 繰入を除いた実支出（円） */
  net: number;
  /** 繰入の宛先別内訳（目名ベース） */
  transfersByDestination: MOFAmountGroup[];
  /** 使途別分類の内訳（人件費・物件費など） */
  byPurpose: MOFAmountGroup[];
}

/** 歳入の内訳 */
export interface MOFRevenueBreakdown {
  /** 歳入合計（円） */
  total: number;
  /** 款別の内訳 */
  byCategory: MOFAmountGroup[];
}

/** 特別会計1つぶんの要約 */
export interface MOFSpecialAccountSummary {
  name: string;
  /** 勘定数（勘定を持たない会計は 0） */
  subAccountCount: number;
  revenue: number;
  expenditure: number;
  /** 他会計から受け入れた額（款 `他会計より受入` と目 `一般会計より受入` の和集合） */
  transferIn: number;
  /** 他会計へ繰り入れた額（使途別分類コード = 6） */
  transferOut: number;
  /**
   * 自前財源比率。歳入のうち他会計からの受入でない割合（0〜1）。
   * 低いほど「一般会計から回ってきた金を通しているだけ」の性格が強い。
   */
  ownRevenueRate: number;
}

/** 宛先別に送り手と受け手を突き合わせた行 */
export interface MOFTransferReconciliation {
  /** 宛先の特別会計名 */
  account: string;
  /** 一般会計からの繰入（送り手側の集計） */
  fromGeneral: number;
  /** 受入合計（受け手側の集計。他会計すべてを含む） */
  received: number;
}

/** 会計間の繰入 */
export interface MOFTransferSummary {
  /** 一般会計 → 他会計（使途別 = 6） */
  generalToOther: number;
  /** 特別会計 → 他会計（使途別 = 6） */
  specialToOther: number;
  /** 特別会計が受け入れた額（款・目の和集合） */
  receivedBySpecial: number;
  /** 勘定間の受入（款 `他勘定より受入`） */
  receivedBetweenSubAccounts: number;
  /**
   * 特別会計 → 一般会計。歳出予算には載らず、一般会計歳入の
   * 款 `諸収入` の目 `◯◯特別会計受入金` にのみ現れる（原資は剰余金）。
   */
  specialToGeneral: number;
  /** 逆方向繰入の内訳 */
  specialToGeneralDetail: MOFAmountGroup[];
  /** 宛先別の突合 */
  reconciliation: MOFTransferReconciliation[];
}

/** グロスと純計 */
export interface MOFTotals {
  /** 一般会計・特別会計・政府関係機関の歳出を単純合計した額 */
  gross: number;
  /** グロスから会計間・勘定間の受入を控除した額 */
  net: number;
  /** 控除の内訳 */
  deductions: {
    receivedBySpecial: number;
    receivedBetweenSubAccounts: number;
  };
}

/** 生成物の本体（年度ごとに1ファイル） */
export interface MOFBudgetOverview {
  metadata: {
    fiscalYear: number;
    /** 元号表記（例: 令和8年度）。改元年は「令和元年度」 */
    eraLabel: string;
    /** 現状は当初予算のみを対象にする */
    budgetType: '当初予算';
    /** 収録済みの年度（API が応答時に付与する。生成物には入らない） */
    availableYears?: number[];
    generatedAt: string;
    unit: 'yen';
    notes: string[];
  };
  generalAccount: {
    revenue: MOFRevenueBreakdown & {
      /** 租税の税目別内訳 */
      taxes: MOFAmountGroup[];
      /** 特別会計からの受入（款 `諸収入` 等の目 `◯◯特別会計受入金`） */
      fromSpecialAccounts: MOFAmountGroup[];
    };
    expenditure: MOFExpenditureBreakdown;
  };
  specialAccounts: {
    revenue: MOFRevenueBreakdown & {
      /**
       * 他会計・他勘定からの受入を除いた自前財源。
       * 会計をまたぐ流れを二重に数えないよう、図の財源にはこちらを使う。
       */
      own: MOFRevenueBreakdown;
    };
    expenditure: MOFExpenditureBreakdown;
    /** 会計別の要約（歳出の大きい順） */
    accounts: MOFSpecialAccountSummary[];
  };
  agencies: {
    revenue: MOFRevenueBreakdown;
    expenditure: {
      total: number;
      byAgency: MOFAmountGroup[];
    };
  };
  transfers: MOFTransferSummary;
  totals: MOFTotals;
}

/** サンキーのノード種別 */
export type MOFBudgetNodeType =
  /** 財源（税目・公債金・保険収入など） */
  | 'source'
  /** 会計（一般会計・特別会計・政府関係機関） */
  | 'account'
  /** 他会計へ繰入。会計をまたぐと二重計上になる分 */
  | 'transfer'
  /** 繰入を除いた実支出 */
  | 'net-expenditure'
  /** 歳入が歳出を上回る差額（積立等） */
  | 'surplus';

/** ノードに添える詳細 */
export interface MOFBudgetNodeDetails {
  nodeType: MOFBudgetNodeType;
  accountKind?: MOFAccountKind;
  /** 内訳（税目別・宛先別など） */
  breakdown?: MOFAmountGroup[];
  /** 純計を出すときに控除する対象か */
  isDeduction?: boolean;
  description?: string;
}

/** API が返すサンキーデータ */
export interface MOFBudgetOverviewData {
  metadata: MOFBudgetOverview['metadata'] & {
    /** 単純合計（円） */
    grossTotal: number;
    /** 一次純計（円） */
    netTotal: number;
  };
  sankey: {
    nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[];
    links: SankeyLink[];
  };
  summary: {
    generalAccount: { revenue: number; expenditure: number; transferOut: number; net: number };
    specialAccounts: { revenue: number; expenditure: number; transferOut: number; net: number };
    agencies: { expenditure: number };
    transfers: MOFTransferSummary;
    totals: MOFTotals;
    accounts: MOFSpecialAccountSummary[];
  };
}
