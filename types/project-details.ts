/**
 * 事業詳細情報の型定義
 *
 * データソース: data/year_2024/1-2_RS_2024_基本情報_事業概要等.csv
 * 出力先: public/data/rs2024-project-details.json
 */

/**
 * 実施方法のフラグ（CSV列25-30）
 */
export type ImplementationMethod =
  | '直接実施'
  | '補助'
  | '負担'
  | '交付'
  | '分担金・拠出金'
  | 'その他';

/**
 * 個別事業の詳細情報
 */
export interface ProjectDetail {
  /** 予算事業ID（列3） */
  projectId: number;

  /** 事業名（列4） */
  projectName: string;

  /** 府省庁（列7） */
  ministry: string;

  /** 局・庁（列8） */
  bureau: string;

  /** 事業の目的（列14） - 長文 */
  purpose: string;

  /** 現状・課題（列15） - 長文 */
  currentIssues: string;

  /** 事業の概要（列16） - 長文 */
  overview: string;

  /** 事業概要URL（列17） - 空の場合はnull */
  url: string | null;

  /** 事業区分（列18）: 前年度事業/新規事業/等 */
  category: string;

  /** 事業開始年度（列19） - 不明の場合はnull */
  startYear: number | null;

  /** 開始年度不明フラグ（列20） */
  startYearUnknown: boolean;

  /** 事業終了(予定)年度（列21） - 終了予定なしの場合はnull */
  endYear: number | null;

  /** 終了予定なしフラグ（列22） */
  noEndDate: boolean;

  /** 主要経費（列23） */
  majorExpense: string;

  /** 備考（列24） */
  remarks: string;

  /** 実施方法（列25-30のフラグを配列化） */
  implementationMethods: ImplementationMethod[];

  /** 旧事業番号（列31） */
  oldProjectNumber: string;
}

/**
 * 全事業詳細データのマップ構造
 * Key: projectId（文字列化）
 * Value: ProjectDetail
 */
export type ProjectDetailsData = Record<string, ProjectDetail>;
