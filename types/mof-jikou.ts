/**
 * 財務省 予算書「事項別内訳」データの型定義。
 *
 * 事項（じこう）は予算書の〔組織別事項別内訳〕（一般会計）／〔歳出 事項別内訳〕（特別会計）／
 * 〔支出 事項別内訳〕（政府関係機関）に現れる階層で、項の下に置かれた経費のまとまりを指す。
 * MOF 側で唯一「事業らしい」名前と説明文を持つ粒度。
 *
 * 詳細は docs/mof-budget-data-guide.md を参照。
 */

/** 会計区分 */
export type MOFAccountType = 'general' | 'special' | 'agency';

/**
 * 補正予算の号数。実績上の最大は平成23年度の第4号。
 * 号数は会計ごとに独立採番なので、同じ号数でも会計により成立した国会が違うことがある
 * （docs/mof-budget-data-guide.md 1節）。
 */
export type MOFRevisionNumber = 1 | 2 | 3 | 4;

/** 補正予算の種別（号数つき） */
export type MOFRevisedBudgetType = `補正予算（第${MOFRevisionNumber}号）`;

/** 補正予算の号数の一覧（若い順） */
export const MOF_REVISION_NUMBERS: readonly MOFRevisionNumber[] = [1, 2, 3, 4];

/** 号数から予算種別名を作る */
export function revisedBudgetType(revision: MOFRevisionNumber): MOFRevisedBudgetType {
  return `補正予算（第${revision}号）`;
}

/** 予算の種別 */
export type MOFBudgetType = '当初予算' | '暫定予算' | MOFRevisedBudgetType | '決算';

/** 事項1件 */
export interface MOFJikouItem {
  /**
   * 掲載位置ベースの行ID: {会計区分}-{帳票ID}-{ページ}-{行}。
   * 同一年度の同一帳票内では一意だが、予算書が改版されるとページがずれる。
   * 年度をまたいで同じ事項を追跡する用途には key を使うこと。
   */
  id: string;
  /**
   * 内容ベースの合成キー。次の順に `|` で連結する:
   * 会計区分・予算種別・所管・組織・特別会計・勘定・機関・項コード・事項名。
   * MOF は事項に公式なIDを振っていないため、これが実質的な識別子になる。
   * 予算種別を含めないと当初・暫定・補正で同じ事項が衝突する。
   * 令和8年度の全2,685件で重複なし。
   */
  key: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  /** 帳票ID（例: 202611001 = 令和8年度一般会計当初予算） */
  documentId: string;
  /** 所管（一般会計は単独省庁、特別会計は共管グループ名。政府関係機関は空） */
  ministry: string;
  /** 組織（一般会計のみ。例: 内閣本府） */
  organization: string;
  /** 特別会計名（特別会計のみ。例: エネルギー対策特別会計） */
  specialAccount: string;
  /** 勘定名（特別会計）／業務区分（政府関係機関）。持たないものは空 */
  subAccount: string;
  /** 政府関係機関名（政府関係機関のみ。例: 沖縄振興開発金融公庫） */
  agency: string;
  /** 項コード（組織・勘定内での連番。単独では一意にならない） */
  sectionCode: string;
  /** 項名 */
  sectionName: string;
  /** 主要経費別分類コード */
  majorExpenseCode: string;
  /** 主要経費別分類名（コード表から解決。未知コードは空文字） */
  majorExpenseName: string;
  /** 事項名 */
  name: string;
  /**
   * 本年度額（円）。補正予算では補正後（改）予算額、決算では歳出予算額。
   * 予算書の印字は千円単位（決算書は円単位）だが、リポジトリ全体の金額規約に
   * 合わせて生成時に円へ揃えている。予算書の CSV と突き合わせるときは1000で割ること。
   */
  amount: number;
  /**
   * 比較対象額（円）。当初予算では前年度予算額、補正予算では補正前の成立予算額。
   * 暫定予算のように帳票に比較欄が無い場合は null。
   */
  previousAmount: number | null;
  /** 増減額（円。減額は負値）。比較欄が無い帳票では null */
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
  /** 不用額（円。決算報告書では「差引額」） */
  unused: number | null;
  /** 説明（所掌事務・根拠法等。予算書の「説明」欄の全文） */
  description: string;
  /** 予算書のページ番号 */
  page: number;
  /** 出典 XML の URL */
  sourceUrl: string;
}

/** 集計の1要素 */
export interface MOFJikouGroupSummary {
  key: string;
  count: number;
  amount: number;
}

/** 出力 JSON 全体 */
export interface MOFJikouData {
  metadata: {
    /** 会計年度（西暦） */
    fiscalYear: number;
    /** 元号表記（例: 令和8年度） */
    eraLabel: string;
    /** 収録した予算種別 */
    budgetTypes: MOFBudgetType[];
    /** 取り込んだ帳票の一覧 */
    documents: Array<{
      documentId: string;
      accountType: MOFAccountType;
      budgetType: MOFBudgetType;
      title: string;
      url: string;
      pages: number;
      count: number;
    }>;
    /** 金額の単位。予算書は千円・決算書は円だが、生成時に円へ揃えている */
    unit: 'yen';
    /** 生成日時（ISO8601） */
    generatedAt: string;
    /**
     * 収録済みの会計年度一覧（新しい順）。API が応答時に付与する。
     * 生成した JSON ファイル自体は自年度しか知らないので、ここは省略されうる。
     */
    availableYears?: number[];
    notes: string[];
  };
  summary: {
    count: number;
    /**
     * 総額は持たない。当初・暫定・補正は同じ予算の別断面であり、会計間の繰入も
     * 重複するため、全件を足した1つの数字は意味を持たない。内訳だけを提供する。
     */
    byAccountType: MOFJikouGroupSummary[];
    byBudgetType: MOFJikouGroupSummary[];
    byMinistry: MOFJikouGroupSummary[];
    byMajorExpense: MOFJikouGroupSummary[];
  };
  items: MOFJikouItem[];
}

/** 事項の経年推移: ある年度に現れた同一事項 */
export interface MOFJikouHistoryYear {
  fiscalYear: number;
  eraLabel: string;
  /** その年度に現れた全予算種別の事項（当初・暫定・補正・決算） */
  items: MOFJikouItem[];
}

/**
 * 事項の経年推移（GET /api/mof-jikou/history のレスポンス）。
 *
 * 同一事項の判定は key から予算種別を除いた識別子で行う。
 * 事項名が改称されると別の事項として扱われるため、実態が継続でも欠けて見えることがある。
 */
export interface MOFJikouHistory {
  /** 問い合わせに使われた key */
  key: string;
  /** 予算種別を除いた識別子 */
  identity: string;
  /** 事項名（見つかった中で最初のもの） */
  name: string;
  /** 収録済みの全年度（新しい順）。推移の横軸 */
  availableYears: number[];
  /** 事項が現れた年度（古い順）。計上のない年度は要素ごと現れない */
  years: MOFJikouHistoryYear[];
}
