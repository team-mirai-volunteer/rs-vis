/**
 * 財務省 予算書「項」一覧の型定義。
 *
 * `/mof-jikou`（事項＝目的別内訳）と `/mof-kou-moku`（目＝性質別内訳）は、共通の親である
 * 「項」の下に並列にぶら下がる別系統の内訳（対応表はない）。このページはさらに一段引いて、
 * 項ごとに「事項が何件、目が何件あり、そのうち目の完全一致でRS事業に何件紐づいているか」
 * という関係性だけを見る。
 *
 * 集計は app/lib/api/mof-kou-loader.ts が、正準データ mof-budget-{年度}.json
 * （項を頂点に事項・目を子として持つ統合JSON）を直接読み、RS紐づけ
 * （mof-rs-kou-moku-linkage）だけをリクエスト時に上乗せする。
 */

import type { MOFBudgetType } from './mof-jikou';
import type { MOFKouMokuAccountType, MOFKouMokuGroupSummary } from './mof-kou-moku';
import type { MOFJikouItem } from './mof-jikou';
import type { MOFKouMokuItem } from './mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from './mof-rs-kou-moku-linkage';

/** 項1件ぶんの集計行（一覧表示用。詳細な内訳は含まない） */
export interface MOFKouSectionSummary {
  /** 会計区分・予算種別・所管・組織/特会/機関・勘定・項コードを連結した合成キー */
  id: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  ministry: string;
  /** 一般会計のみ（特別会計・政府関係機関は空） */
  organization: string;
  /** 特別会計のみ（他は空） */
  specialAccount: string;
  subAccount: string;
  /** 政府関係機関のみ（他は空） */
  agency: string;
  sectionCode: string;
  sectionName: string;
  /**
   * 項自体の出典ページ番号。「甲号歳入歳出予算」（一般会計）・「歳入歳出予算」（特別会計）・
   * 「収入支出予算」（政府関係機関）という、事項・目とは独立した別帳票から項名一致で突合する
   * （項コードを持たない帳票のため名前一致のみ）。突合できない場合は null
   */
  page: number | null;
  /** page が null のときは空文字列（詳細は page と同じ） */
  sourceUrl: string;
  /**
   * 主要経費（金額最大のもの）。項と主要経費は1対1ではなく、複数の主要経費が
   * 混在する項が実際にある（2024年度実測: kou-mokuで3,321項中302項）。
   * `majorExpenseMixed` が true のときは、この項内で最大シェアの主要経費を代表値として示す。
   */
  majorExpenseName: string;
  /** true のときこの項には2種類以上の主要経費が混在する（金額最大のものを majorExpenseName に採用） */
  majorExpenseMixed: boolean;
  /**
   * 使途別分類（金額最大のもの）。主要経費と同じ理由で項と1対1ではない。
   * 使途別分類コードは目（kou-moku）にしか無いフィールドのため、事項側からは算出しない。
   */
  purposeName: string;
  /** true のときこの項には2種類以上の使途別分類が混在する（金額最大のものを purposeName に採用） */
  purposeMixed: boolean;
  /** この項に属する事項（目的別内訳）の件数 */
  jikouCount: number;
  /** この項に属する目（性質別内訳）の件数 */
  kouMokuCount: number;
  /** この項に属する事項名・目名（重複除き）。一覧の検索フィルタが事項・目の中身まで見るために持つ */
  detailNames: string[];
  /** 目の完全一致で紐づいたRS事業の実数（重複除き） */
  rsProjectCount: number;
  /** 項の本年度額（円）。目（kou-moku）側の合計 */
  amount: number;
  /** 前年度額（円）。項内のいずれかの目で比較対象額が無ければ null */
  previousAmount: number | null;
  difference: number | null;
}

/** 1項ぶんの詳細（行を展開したときに取得） */
export interface MOFKouSectionDetail {
  id: string;
  jikouItems: MOFJikouItem[];
  kouMokuItems: MOFKouMokuItem[];
  /** 目単位のRS紐づけ（mof-rs-kou-moku-linkage。完全一致・カバレッジが広い）。kouMokuKeyで各目に対応づく */
  rsLinks: MofRsKouMokuLinkageRecord[];
}

/** 出力（一覧API）全体 */
export interface MOFKouData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    budgetTypes: MOFBudgetType[];
    unit: 'yen';
    generatedAt: string;
    /** 収録済みの会計年度一覧（新しい順）。API が応答時に付与する */
    availableYears?: number[];
    /** その年度のRS紐づけ状況（mof-rs-kou-moku-linkage-loader.resolveLinks と同じ意味） */
    linkage: {
      available: boolean;
      rsYear: number | null;
    };
    notes: string[];
  };
  summary: {
    count: number;
    byAccountType: MOFKouMokuGroupSummary[];
    byBudgetType: MOFKouMokuGroupSummary[];
  };
  sections: MOFKouSectionSummary[];
}

/** 項の経年推移: ある年度に現れた同一の項（予算種別ごとに複数行になりうる） */
export interface MOFKouSectionHistoryYear {
  fiscalYear: number;
  eraLabel: string;
  /** その年度にこの項で現れた予算種別ごとの集計行（当初・暫定・補正・決算） */
  rows: MOFKouSectionSummary[];
}

/**
 * 項の経年推移（GET /api/mof-kou/history のレスポンス）。
 *
 * 同一の項の判定は所管（ministry）・予算種別を除いた識別子（会計区分・組織/特会/機関・
 * 勘定・項コード）で行う。所管表記の変更（共管の追加・解消）や項コードの振り直しがあると
 * 別の項として扱われ、実態が継続でも欠けて見えることがある（`/mof-jikou`・`/mof-kou-moku`の
 * 経年推移と同じ限界）。
 */
export interface MOFKouSectionHistory {
  /** 問い合わせに使われた項の合成キー（sections[].id） */
  id: string;
  /** 予算種別・所管を除いた識別子 */
  identity: string;
  /** 項名（見つかった中で最初のもの） */
  sectionName: string;
  /** 収録済みの全年度（新しい順）。推移の横軸 */
  availableYears: number[];
  /** 項が現れた年度（古い順）。計上のない年度は要素ごと現れない */
  years: MOFKouSectionHistoryYear[];
}
