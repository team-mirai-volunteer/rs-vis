/** 会計検査院「決算検査報告」の個別の指摘と、RS事業（予算事業ID）への対応。生成は scripts/generate-audit-report.py */

export interface AuditReportItem {
  /** `${fiscalYear}-${検査報告データベースのページ番号}`（例: 2024-0042-0） */
  id: string;
  /** 検査した決算の年度（西暦）。令和6年度決算検査報告なら 2024 */
  fiscalYear: number;
  era: string;
  /** 検査報告の府省の見出し */
  ministry: string;
  /** 不当事項 / 意見を表示し又は処置を要求した事項 / 本院の指摘に基づき当局において改善の処置を講じた事項 */
  kind: string;
  /** 補助金・工事・物件・役務など（検査報告データベースの分類） */
  category: string | null;
  title: string;
  /** 会計名及び科目。対応づけにだけ使う */
  subject: { account: string; organizations: string[]; sections: string[] } | null;
  programs: string[];
  /** 不当事項の「不当と認める…額」の公表表記。意見・処置要求などは金額の意味が事項ごとに違うので null */
  amountText: string | null;
  amount: number | null;
  /** 検査報告データベースのページ */
  url: string;
  pids: number[];
  match: 'reviewed' | 'none';
  matchNote: string | null;
}

export interface AuditReportFile {
  metadata: {
    source: string;
    sourceUrl: string;
    license: string;
    retrievedOn: string;
    unit: string;
    matching: string;
    reviewedBy: string | null;
  };
  items: AuditReportItem[];
  byPid: Record<string, string[]>;
}
