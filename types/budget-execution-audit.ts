/** 財務省「予算執行調査」の事案と、RS事業（予算事業ID）への対応。生成は scripts/generate-budget-execution-audit.py */

export interface BudgetExecutionAuditCase {
  /** `${surveyYear}-${no}`（例: 2025-08） */
  id: string;
  /** 調査を行った年度（西暦の会計年度） */
  surveyYear: number;
  /** 和暦の年度表記（例: 令和7年度） */
  era: string;
  no: number;
  /** 一覧表の府省。共同の事案は複数 */
  ministries: string[];
  title: string;
  /** 総括調査票の見出しから読み取った値。読み取れなかったものは null（項・目は対応づけにだけ使い、画面には出さない） */
  organization: string | null;
  account: string | null;
  section: string | null;
  subItem: string | null;
  /** 調査対象予算額（公表の文言のまま。「〜の内数」「ほか」を含む） */
  budgetText: string | null;
  /** 本省調査 / 共同調査（○○財務局） */
  surveyBody: string | null;
  /** 総括調査票 PDF */
  resultUrl: string;
  /** 翌年度予算案への反映状況票 PDF（翌年1月公表。未公表なら null） */
  reflectionUrl: string | null;
  /** 反映額の公表表記（「▲515」「－」） */
  reflectionText: string | null;
  /** 反映額（円）。削減は負。反映額が無い・未公表なら null */
  reflectionAmount: number | null;
  /** 対応する予算事業ID。空なら横断調査など、RS事業に結びつけないもの */
  pids: number[];
  match: 'reviewed' | 'none' | 'pending';
  /** same: 事案がRS事業そのもの / part: RS事業の一部が調査対象 */
  scope: 'same' | 'part' | null;
  matchNote: string | null;
}

export interface BudgetExecutionAuditFile {
  metadata: {
    source: string;
    sourceUrl: string;
    license: string;
    retrievedOn: string;
    unit: string;
    matching: string;
    reviewedBy: string | null;
  };
  cases: BudgetExecutionAuditCase[];
  /** 予算事業ID → 事案ID */
  byPid: Record<string, string[]>;
}
