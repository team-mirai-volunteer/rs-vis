/**
 * 財務省 予算書「科目別内訳」（項・目）データの型定義。
 *
 * `/mof-jikou` が Web帳票の〔事項別内訳〕（項の下の「事項」）を扱うのに対し、
 * こちらは ZIP 同梱 CSV の科目別内訳（項の下の「目」）を扱う。
 * 目は「庁費」「職員基本給」のような支出の性質による分類で、事項（目的による分類）とは
 * 別の切り口の内訳（docs/mof-budget-data-guide.md 参照）。RS システムの
 * `2-2_予算・執行_予算種別・歳出予算項目` も 所管/組織・勘定/項/目 を同じ語彙で持つため、
 * 目レベルはMOFとRSを構造的に直接突き合わせられる。
 *
 * 当初・暫定・補正・決算のZIPをすべて収録する（`/mof-jikou` と同じ予算種別の粒度）。
 * ただし暫定・補正は年度により存在しない（暫定は令和8年度のみ、補正は号数が年度で変わる）。
 */

import type { MOFBudgetType } from './mof-jikou';

export type { MOFBudgetType } from './mof-jikou';

/** 会計区分 */
export type MOFKouMokuAccountType = 'general' | 'special' | 'agency';

/** 目1件（科目別内訳の1行） */
export interface MOFKouMokuItem {
  /** 行ID。同一年度・会計区分・予算種別内で一意（CSV内の出現順） */
  id: string;
  /**
   * 内容ベースの合成キー。会計区分・予算種別・所管・組織／特別会計／機関・勘定・
   * 項コード・目分類コード・目名を `|` で連結したもの。MOFは目にも公式なIDを
   * 振っていないため、これが実質的な識別子になる
   * （年度をまたぐ追跡は事項以上に不安定なため現状は未対応）。
   */
  key: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  /** 所管（一般会計は単独省庁、特別会計は共管グループ名。政府関係機関は空） */
  ministry: string;
  /** 組織（一般会計のみ。例: 内閣本府） */
  organization: string;
  /** 特別会計名（特別会計のみ） */
  specialAccount: string;
  /** 勘定名（特別会計のみ。空のことが多い） */
  subAccount: string;
  /** 政府関係機関名（政府関係機関のみ） */
  agency: string;
  /** 項コード（組織・勘定内での連番。単独では一意にならない） */
  sectionCode: string;
  /** 項名 */
  sectionName: string;
  /** 主要経費別分類コード（政府関係機関の帳票には無い） */
  majorExpenseCode: string;
  /** 主要経費別分類名（コード表から解決。未知コード・無い帳票は空文字） */
  majorExpenseName: string;
  /** 目的別分類コード（3桁。政府関係機関の帳票には無い） */
  objectiveCode: string;
  /** 目的別分類名（コード表から解決。未知コード・無い帳票は空文字） */
  objectiveName: string;
  /** 財政法公債金対象非対象別分類コード（1桁。一般会計にしか無い） */
  fiscalLawCode: string;
  /** 財政法公債金対象非対象別分類名（コード表から解決。無い帳票は空文字） */
  fiscalLawName: string;
  /** 経済性質別分類コード（2桁。政府関係機関の帳票には無い） */
  economicNatureCode: string;
  /** 経済性質別分類名（コード表から解決。未知コード・無い帳票は空文字） */
  economicNatureName: string;
  /** 目別分類コード（政府関係機関は「目コード」列、決算は「目番号」列） */
  subItemCode: string;
  /** 目名 */
  subItemName: string;
  /** 使途別分類コード */
  purposeCode: string;
  /** 使途別分類名（コード表から解決。未知コードは空文字） */
  purposeName: string;
  /**
   * 本年度額（円）。予算書の印字は千円単位（決算は円単位）だが、生成時に円へ揃えている。
   * 補正予算では改予算額（その号の成立後の姿）、決算では歳出予算額。
   */
  amount: number;
  /**
   * 比較対象額（円）。当初・暫定は前年度予算額、補正は補正前の成立予算額。
   * 決算の帳票には比較欄が無いため null。
   */
  previousAmount: number | null;
  /** 増減額（円。減額は負値）。決算の帳票には比較欄が無いため null */
  difference: number | null;
  /**
   * 以下は決算の帳票にだけ入る。予算の帳票では null。
   * 歳出予算現額（歳出予算額＋前年度繰越＋予備費使用＋流用等＋移替）。
   */
  currentAmount: number | null;
  /** 支出済歳出額（円） */
  spent: number | null;
  /** 翌年度繰越額（円） */
  carriedOver: number | null;
  /** 不用額（円） */
  unused: number | null;
  /** 帳票ID（例: 202611001 = 令和6年度一般会計当初予算） */
  documentId: string;
  /**
   * 出典URLのページ番号。一般会計（決算を除く）は科目別内訳のWebページ（事項別内訳と
   * 並列の同じ帳票ファミリー）を走査して、行単位で正確なページを特定している
   * （実測一致率99.98%。generate-mof-kou-moku-data.ts の buildGeneralPageMap 参照）。
   * 特別会計・政府関係機関・決算はまだページ特定ロジックが無いため null（帳票トップページの
   * リンクのみ）。
   */
  page: number | null;
  /** 出典URL。page が null のときは帳票トップページ（Main.html）を指す */
  sourceUrl: string;
}

/** 集計の1要素 */
export interface MOFKouMokuGroupSummary {
  key: string;
  count: number;
  amount: number;
}

/** 出力 JSON 全体 */
export interface MOFKouMokuData {
  metadata: {
    /** 会計年度（西暦） */
    fiscalYear: number;
    /** 元号表記（例: 令和8年度） */
    eraLabel: string;
    /** 収録した予算種別（年度により暫定・補正が無いことがある） */
    budgetTypes: MOFBudgetType[];
    /** 取り込んだ帳票の一覧 */
    documents: Array<{
      accountType: MOFKouMokuAccountType;
      budgetType: MOFBudgetType;
      title: string;
      count: number;
      /** 出典帳票トップページのURL */
      url: string;
    }>;
    unit: 'yen';
    generatedAt: string;
    /** 収録済みの会計年度一覧（新しい順）。API が応答時に付与する */
    availableYears?: number[];
    notes: string[];
  };
  summary: {
    count: number;
    byAccountType: MOFKouMokuGroupSummary[];
    byBudgetType: MOFKouMokuGroupSummary[];
    byMinistry: MOFKouMokuGroupSummary[];
    byMajorExpense: MOFKouMokuGroupSummary[];
    byPurpose: MOFKouMokuGroupSummary[];
  };
  items: MOFKouMokuItem[];
}

/** 目の経年推移: ある年度に現れた同一の目 */
export interface MOFKouMokuHistoryYear {
  fiscalYear: number;
  eraLabel: string;
  /** その年度に現れた全予算種別の目（当初・暫定・補正・決算） */
  items: MOFKouMokuItem[];
}

/**
 * 目の経年推移（GET /api/mof-kou-moku/history のレスポンス）。
 *
 * 同一の目の判定は key から予算種別を除いた識別子で行う。
 * 目名が改称されたり目別分類コードが振り直されたりすると別の目として扱われるため、
 * 実態が継続でも欠けて見えることがある（`/mof-jikou` の事項と同じ限界）。
 */
export interface MOFKouMokuHistory {
  /** 問い合わせに使われた key */
  key: string;
  /** 予算種別を除いた識別子 */
  identity: string;
  /** 目名（見つかった中で最初のもの） */
  name: string;
  /** 収録済みの全年度（新しい順）。推移の横軸 */
  availableYears: number[];
  /** 目が現れた年度（古い順）。計上のない年度は要素ごと現れない */
  years: MOFKouMokuHistoryYear[];
}
