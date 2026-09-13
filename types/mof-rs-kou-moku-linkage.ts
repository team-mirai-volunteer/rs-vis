/**
 * MOF目（科目別内訳） ↔ RS事業 紐づけデータの型定義。
 *
 * `types/mof-rs-linkage.ts`（MOF事項＝目的別の内訳 ↔ RS事業）と対になる、
 * MOF目＝性質別の内訳 ↔ RS事業 の紐づけ。RS の `2-2_予算・執行_予算種別・歳出予算項目` は
 * 一般会計なら 所管/組織・勘定/項/目、特別会計なら 所管/会計/勘定/項/目 を MOF の
 * 科目別内訳CSVと同じ語彙で持つため、事項と違って**名前照合ではなく完全一致キーで
 * 直接突き合わせられる**（実測: 一般会計・当初予算でRS行の92.7%・金額の97.9%、
 * 特別会計・当初予算で行の86.6%・金額の98.9%が一致。docs/tasks/参照）。
 * 政府関係機関はRSの `会計区分` に該当値が無く対象外。
 * 生成: scripts/generate-mof-rs-kou-moku-linkage.ts
 */

import type { MOFBudgetType, MOFKouMokuAccountType } from './mof-kou-moku';

/** 紐づけ1件（事業×目のペア。1つの目に複数のRS事業が計上されることがある） */
export interface MofRsKouMokuLinkageRecord {
  projectId: number;
  projectName: string;
  projectMinistry: string;
  /** MOF目の合成キー（`MOFKouMokuItem.key`） */
  kouMokuKey: string;
  mofAccountType: MOFKouMokuAccountType;
  /**
   * MOF側の予算種別。RS側は「第N次補正予算」表記だが、ここはMOF側の
   * 「補正予算（第N号）」表記（対応関係は generate-mof-rs-kou-moku-linkage.ts 参照）。
   */
  mofBudgetType: MOFBudgetType;
  mofMinistry: string;
  /** 組織（一般会計）または特別会計名（特別会計） */
  mofOrganization: string;
  /** 勘定名（特別会計のみ。一般会計は空） */
  mofSubAccount: string;
  sectionCode: string;
  sectionName: string;
  subItemCode: string;
  subItemName: string;
  /** MOF目の本年度額（円）。決算では決算額（歳出予算額） */
  kouMokuAmount: number;
  /**
   * 当該事業・当該目に計上されたRS予算額（円）。同一キーに複数行あれば合算。
   * `carriedOverFrom` がある場合は元の予算側リンクのRS予算額をそのまま引き継いだもので、
   * この決算目に対応するRS側の実行額ではない（RSは項目別の決算・執行額を持たないため）。
   */
  rsAmount: number;
  /**
   * この決算目へのリンクが、同一識別子（会計区分・所管・組織/特会・勘定・項コード・
   * 目分類コード・目名。予算種別を除く）を持つ予算側（当初予算／補正予算）のリンクから
   * 引き継がれたものである場合、その元の予算種別。直接キー一致したリンクでは undefined。
   * RSは決算・執行実績を目単位で持たないため、決算目への紐づけは常にこの引き継ぎ経由になる。
   */
  carriedOverFrom?: MOFBudgetType;
}

/** 出力 JSON 全体 */
export interface MofRsKouMokuLinkageData {
  metadata: {
    /** 予算年度 = MOF会計年度（西暦） */
    budgetYear: number;
    /** RS事業年度（シート年度） */
    rsYear: number;
    mofEraLabel: string;
    /** 突合範囲（現状は一般会計・当初予算のみ） */
    scope: string;
    unit: 'yen';
    generatedAt: string;
    counts: {
      links: number;
      /** 突合範囲内のMOF目総数 */
      kouMokuTotal: number;
      /** 1件以上の事業に紐づいた目数 */
      kouMokuLinked: number;
      /** 突合範囲内のRS事業総数 */
      projectTotal: number;
      /** 1件以上の目に紐づいた事業数 */
      projectLinked: number;
      /** 突合範囲内のRS予算行総数 */
      rowsTotal: number;
      /** 完全一致キーで紐づいた行数 */
      rowsLinked: number;
    };
    coverage: {
      /** 突合範囲内のRS予算総額（円） */
      rsAmountTotal: number;
      /** 紐づいた予算額合計（円） */
      rsAmountLinked: number;
    };
    notes: string[];
  };
  links: MofRsKouMokuLinkageRecord[];
}

/** GET /api/mof-kou-moku/linkage のレスポンス */
export interface MofRsKouMokuLinkageResponse {
  available: boolean;
  rsYear: number | null;
  links: MofRsKouMokuLinkageRecord[];
}
