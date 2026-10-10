/**
 * 概算要求（原資料の歳出概算要求額明細表）と RS 事業の対応。
 *
 * 対応の単位は「歳出予算項目（所管・組織・項・目）」。RS のレビューシート 2-2 は各事業が使う
 * 項・目を持ち、明細表は 項・目 ごとの要求額を持つので、両者を 目 の名前で突き合わせる。
 * 目 は複数の事業で共有されるため、要求額は「その 目 全体」の額であり、事業への按分はしない。
 */
export interface BudgetRequestLinkItem {
  /** RS 2-2 の 所管（例: 文部科学省） */
  ministry: string;
  /** RS 2-2 の 組織・勘定（例: 文部科学本省） */
  organization: string;
  /** RS 2-2 の 項 */
  kou: string;
  /** RS 2-2 の 目 */
  moku: string;
  /** この事業が 2025 年度当初予算で 目 から受けている額（円）。RS 2-2 の予算額 */
  rsBudgetYen: number;
  /** この事業の 2026 年度要求額（円）。RS 2-2 の翌年度要求額 */
  rsNextRequestYen: number;
  /** 原資料（明細表）に記載された 目 全体の 2027 年度要求額（円）。同じ 目 の複数行の合計 */
  requestYen: number | null;
  /** 原資料に記載された 目 全体の前年度（2026 年度）予算額（円） */
  previousYen: number | null;
  /** 合算した原資料の行数 */
  rows: number;
  /** 原資料の URL と、最初の行のページ */
  url: string;
  page: number | null;
  documentTitle: string;
  /** 対応づけの根拠: 項と目の一致、または 目 が組織内で一意 */
  matchedBy: 'kou-moku' | 'moku-unique';
}

export interface BudgetRequestUnmatchedItem {
  ministry: string;
  organization: string;
  kou: string;
  moku: string;
  rsBudgetYen: number;
  rsNextRequestYen: number;
}

export interface BudgetRequestProjectLinks {
  /** 原資料を取得できた府省か（取得できていない府省は items も unmatched も空） */
  coverage: 'linked' | 'no-match' | 'not-crawled' | 'no-line-items';
  items: BudgetRequestLinkItem[];
  unmatched: BudgetRequestUnmatchedItem[];
}

export interface BudgetRequestMinistryTotal {
  ministry: string;
  /** 明細表の総計行の名前（組織など） */
  organization: string;
  account: string | null;
  requestYen: number | null;
  previousYen: number | null;
  url: string;
  page: number | null;
  documentTitle: string;
}

export interface BudgetRequestLinksFile {
  schemaVersion: 1;
  requestedFY: number;
  /** 突き合わせに使った RS シート年度（2-2 の予算年度） */
  sheetYear: number;
  generatedAt: string;
  /** 原資料を取得できた府省（RS 2-2 の 所管 の表記） */
  crawledMinistries: string[];
  byPid: Record<string, BudgetRequestProjectLinks>;
  ministries: BudgetRequestMinistryTotal[];
  stats: { projects: number; linked: number; noMatch: number; notCrawled: number; keys: number; matchedKeys: number };
}
