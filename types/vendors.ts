/**
 * 事業者別の横断集計（vendors.json）。生成は scripts/generate-vendors.ts。
 * 契約方式データ（contract-methods-{シート年度}.json）を法人番号（無ければ正規化した名前）でまとめ、
 * 全府省での受注・競争入札の1者応札・随意契約を事業者ごとに見られるようにする。
 * 金額は円。シート年度 N の契約は年度 N−1 の実績（2026 は 2025年度の暫定）。
 */

/** 1つのシート年度の集計 */
export interface VendorYear {
  sheetYear: number;
  /** 方式を問わない支出の合計（補助金等を含む）と件数 */
  amount: number;
  count: number;
  /** 契約（入札・随意契約・国庫債務負担行為）の合計と件数。補助金・運営費交付金・その他は含まない */
  contractAmount: number;
  contractCount: number;
  /** 補助金等・運営費交付金・その他（契約以外）の合計 */
  nonContractAmount: number;
  /** 支出元の事業数・府省数 */
  projects: number;
  ministries: number;
  /** 競争入札（一般・指名）の件数・金額と、そのうち応札が1者だった件数・金額（応札者数の記載がある契約のみ数える） */
  competitiveCount: number;
  competitiveAmount: number;
  competitiveWithApplicants: number;
  singleCount: number;
  singleAmount: number;
  /** 競争入札の落札率（記載のある契約の合計と件数。平均は合計÷件数）。1者応札と複数応札で分ける */
  singleBidRateSum: number;
  singleBidRateN: number;
  multiBidRateSum: number;
  multiBidRateN: number;
  /** 随意契約（競争なし：特命・不落随契）の件数・金額 */
  soleCount: number;
  soleAmount: number;
  /** 随意契約（企画競争・公募）の件数・金額 */
  negotiatedCompetitiveCount: number;
  negotiatedCompetitiveAmount: number;
  /** 国庫債務負担行為（複数年度）の金額 */
  multiYearAmount: number;
}

/** 同じ事業で複数のシート年度にわたって競争入札の1者応札になっている事業 */
export interface VendorRepeatProject {
  pid: string;
  name?: string;
  ministry?: string;
  /** 1者応札だったシート年度 */
  sheetYears: number[];
  /** それらの年度の1者応札の金額合計 */
  amount: number;
}

export interface Vendor {
  /** 法人番号13桁、無ければ "name:正規化名" */
  key: string;
  /** 代表表記（最も多く使われた名前） */
  name: string;
  corporateNumber: string;
  /** 国税庁の法人種別コード（外部情報があるとき） */
  kind?: string;
  /** シート年度ごとの集計（年度の昇順） */
  years: VendorYear[];
  /** 全年度の合計（VendorYear と同じ項目。sheetYear は 0） */
  total: VendorYear;
  /** 支出元の府省（契約金額の大きい順・上位） */
  ministries: { ministry: string; amount: number; projects: number }[];
  /** 2年度以上1者応札が続く事業（金額の大きい順・上位）と、その総数 */
  repeatSingle: VendorRepeatProject[];
  repeatSingleCount: number;
  /** 2年度以上、競争なしの随意契約が続く事業の数 */
  repeatSoleCount: number;
}

export interface VendorsFile {
  metadata: {
    generatedAt: string;
    sheetYears: number[];
    source: string;
    /** 収録の条件 */
    inclusion: string;
    notes: string[];
    vendors: number;
  };
  vendors: Vendor[];
}
