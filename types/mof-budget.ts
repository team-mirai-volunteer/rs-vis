/**
 * MOF予算データの正準統合スキーマ。項を頂点に事項（目的別内訳）・目（性質別内訳）を
 * 子として持つ。事項と目は「項の下に並列にぶら下がる別系統の内訳」であって、
 * 事項の子に目があるわけではない（対応表は無い）。
 *
 * 生成: scripts/generate-mof-budget-data.ts（既存の mof-jikou-{年度}.json・
 * mof-kou-moku-{年度}.json・mof-section-pages-{年度}.json を統合するだけで、
 * スクレイピング・CSV解析自体は行わない）。
 *
 * 注意: /mof-kou は app/lib/api/mof-kou-loader.ts がこの正準データを直接読む
 * （RS紐づけのみ実行時オーバーレイ）。/mof-jikou・/mof-kou-moku はまだ従来の
 * 個別ファイル（mof-jikou-{年度}.json・mof-kou-moku-{年度}.json）を直接読んでおり、
 * この統合ファイルへの移行は別途（ローダーの移行状況は各ページ側の実装を参照）。
 */

import type { MOFAccountType, MOFBudgetType } from './mof-jikou';

export interface MOFJikouLeaf {
  id: string;
  name: string;
  majorExpenseCode: string;
  majorExpenseName: string;
  amount: number;
  previousAmount: number | null;
  difference: number | null;
  /** 以下4つは決算のみ。予算の帳票では null */
  currentAmount: number | null;
  spent: number | null;
  carriedOver: number | null;
  unused: number | null;
  documentId: string;
  page: number;
  sourceUrl: string;
}

export interface MOFKouMokuLeaf {
  id: string;
  subItemCode: string;
  subItemName: string;
  majorExpenseCode: string;
  majorExpenseName: string;
  objectiveCode: string;
  objectiveName: string;
  fiscalLawCode: string;
  fiscalLawName: string;
  economicNatureCode: string;
  economicNatureName: string;
  purposeCode: string;
  purposeName: string;
  amount: number;
  previousAmount: number | null;
  difference: number | null;
  /** 以下4つは決算のみ。予算の帳票では null */
  currentAmount: number | null;
  spent: number | null;
  carriedOver: number | null;
  unused: number | null;
  documentId: string;
  /** 出典ページを特定できたときだけ入る。特定できない場合は null（帳票トップURLでは埋めない） */
  page: number | null;
  /** page が null のときは空文字列 */
  sourceUrl: string;
}

/** 項1件。事項・目は「項の子」であって「事項の子に目がある」わけではない（並列の内訳） */
export interface MOFSection {
  /** 会計区分|予算種別|所管|組織/特会/機関|勘定|項コード */
  id: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  ministry: string;
  organization: string; // 一般会計のみ
  specialAccount: string; // 特別会計のみ
  subAccount: string; // 特別会計・政府関係機関
  agency: string; // 政府関係機関のみ
  sectionCode: string;
  sectionName: string;
  /** 目側の合計（事項側の合計とほぼ一致することを実測済み） */
  amount: number;
  previousAmount: number | null;
  difference: number | null;
  /**
   * 項自体の出典ページ。「甲号歳入歳出予算」等の別帳票（項コードを持たないため
   * 所管×組織/特会×項名の名前一致でのみ突合）。突合できない場合は null
   */
  page: number | null;
  sourceUrl: string;
  jikou: MOFJikouLeaf[];
  koumoku: MOFKouMokuLeaf[];
}

export interface MOFBudgetData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    accountTypes: MOFAccountType[];
    budgetTypes: MOFBudgetType[];
    unit: 'yen';
    generatedAt: string;
    notes: string[];
  };
  sections: MOFSection[];
}

/** mof-budget-descriptions-{年度}.json。MOFJikouLeaf.id → 説明本文（所掌事務・根拠法等） */
export type MOFDescriptionData = Record<string, string>;
