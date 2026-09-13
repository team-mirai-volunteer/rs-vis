/**
 * 財務省 予算書「甲号歳入歳出予算」（一般会計）・「歳入歳出予算」（特別会計）・
 * 「収入支出予算」（政府関係機関）から取得した、項単位の出典ページ情報。
 *
 * 事項・目は明細ごとに出典ページを持つが、項自体（MOFSection）は今まで
 * 出典を持たなかった。この表は項名・金額単位の集計表で、事項別内訳・
 * 科目別内訳とは完全に独立した別帳票（項コードを持たないため名前一致でのみ突合できる）。
 *
 * 生成: scripts/generate-mof-section-page-data.ts
 * v1は当初予算・歳出側のみ（歳入側の値はこの表に載っているが未取得。詳細はスクリプトのコメント参照）。
 */

import type { MOFAccountType, MOFBudgetType } from './mof-jikou';

/** 項1件ぶんの出典ページ情報 */
export interface MOFSectionPageEntry {
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  ministry: string;
  /** 一般会計のみ */
  organization: string;
  /** 特別会計のみ */
  specialAccount: string;
  /** 特別会計の勘定のみ（政府関係機関の業務区分はこの表に無い） */
  subAccount: string;
  /** 政府関係機関のみ */
  agency: string;
  sectionName: string;
  /** この表に印字された歳出額（円）。目側合計との一致確認に使える */
  amount: number;
  page: number;
  documentId: string;
  sourceUrl: string;
}

export interface MOFSectionPageData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    unit: 'yen';
    generatedAt: string;
    notes: string[];
  };
  entries: MOFSectionPageEntry[];
}
