/**
 * RSシステムCSVデータの型定義（実際のフィールド名に基づく）
 */

/**
 * 1-1_RS_2024_基本情報_組織情報.csv
 * 組織階層情報
 */
export interface OrganizationInfo {
  シート種別: string;
  事業年度: string;
  予算事業ID: string;
  事業名: string;
  建制順: string;
  所管府省庁: string;
  府省庁: string;
  '局・庁': string;
  部: string;
  課: string;
  室: string;
  班: string;
  係: string;
}

/**
 * 2-1_RS_2024_予算・執行_サマリ.csv
 * 予算・執行情報のサマリ
 */
export interface BudgetSummary {
  シート種別: string;
  事業年度: string;
  予算事業ID: string;
  事業名: string;
  府省庁の建制順: string;
  政策所管府省庁: string;
  府省庁: string;
  '局・庁': string;
  部: string;
  課: string;
  室: string;
  班: string;
  係: string;
  予算年度: string;
  '当初予算(合計)': string;
  '補正予算(合計)': string;
  '前年度からの繰越し(合計)': string;
  '予備費等(合計)': string;
  '計(歳出予算現額合計)': string;
  '執行額(合計)': string;
  執行率: string;
  '翌年度への繰越し(合計)': string;
  '翌年度要求額(合計)': string;
  会計区分: string;
  会計: string;
  勘定: string;
}

/**
 * 1-2_RS_2024_基本情報_事業概要等.csv
 * 事業概要情報
 */
export interface ProjectOverview {
  シート種別: string;
  事業年度: string;
  予算事業ID: string;
  事業名: string;
  府省庁の建制順: string;
  政策所管府省庁: string;
  府省庁: string;
  '局・庁': string;
  部: string;
  課: string;
  室: string;
  班: string;
  係: string;
  事業開始年度: string;
  開始年度不明: string;
  '事業終了(予定)年度': string;
  終了予定なし: string;
}

/**
 * 5-1_RS_2024_支出先_支出情報.csv
 * 支出先情報
 */
export interface SpendingInfo {
  シート種別: string;
  事業年度: string;
  予算事業ID: string;
  事業名: string;
  府省庁の建制順: string;
  政策所管府省庁: string;
  府省庁: string;
  '局・庁': string;
  部: string;
  課: string;
  室: string;
  班: string;
  係: string;
  支出先ブロック番号: string;
  支出先ブロック名: string;
  支出先の数: string;
  事業を行う上での役割: string;
  ブロックの合計支出額: string;
  支出先名: string;
  法人番号: string;
  所在地: string;
  法人種別: string;
  その他支出先: string;
  支出先の合計支出額: string;
  契約概要: string;
  金額: string;
  契約方式等: string;
  具体的な契約方式等: string;
}

/**
 * CSV行の基本型（パース前の生データ）
 */
export type CSVRow = Record<string, string>;

/**
 * 組織階層パス
 */
export interface HierarchyPath {
  府省庁: string;
  '局・庁': string;
  部: string;
  課: string;
  室: string;
  班: string;
  係: string;
}
