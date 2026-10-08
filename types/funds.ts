/** 基金シート（RSシステムの sheet_type=KS）を年度をまたいでまとめたもの。生成は scripts/generate-funds.ts */

/** 1つのシート年度の数値。シート年度 N の「前年度」は年度 N−1 の実績、残高は年度 N−1 の末（= 年度 N の初め） */
export interface FundYear {
  sheetYear: number;
  /** 年度初めの基金残高（円） */
  balance: number | null;
  /** 国費相当の残高（円） */
  nationalBalance: number | null;
  /** 前年度に国から交付された額 */
  granted: number | null;
  /** 前年度の収入合計・支出合計（円） */
  income: number | null;
  expense: number | null;
  /** 前年度の事業費・管理費（円） */
  businessExpense: number | null;
  adminExpense: number | null;
  /** 前年度の管理費率（%） */
  adminRate: number | null;
  /** 前年度の国庫返納額（円） */
  returned: number | null;
  /** 前年度の乖離率（%。見込みと実績の差） */
  divergence: number | null;
  /** 保有割合（基金残高 ÷ 今後の事業に必要な額） */
  ownership: number | null;
  /** RSシステムの基金シートの id（RSのページへのリンク用） */
  projectId: string;
}

/** 造成の経緯（どの年度のどの予算で、いくら国費を入れたか） */
export interface FundComposition {
  fiscalYear: number | null;
  /** 当初・補正（initial / supplementary1 など） */
  budget: string | null;
  amount: number | null;
  /** 造成元の事業（予算事業ID）。RSシートで突き合わせできたとき */
  pid?: string;
}

/** 低執行基金の点検（基金シートの点検欄）。true の項目が該当 */
export interface FundInspectionFlags {
  noRecentResult: boolean;
  ceasedOperations: boolean;
  lostPurpose: boolean;
  ownershipFarAboveOne: boolean;
  unlikelyToBeUsed: boolean;
}

export interface Fund {
  /** 年度をまたいだ基金の識別子（lineage_id） */
  key: string;
  name: string;
  /**
   * シートごとの事業名（例：安定供給確保支援事業（蓄電池））。同じ基金が造成元の事業ごとに別シートを持つとき、
   * 基金名だけでは見分けられないので併記する。基金名と同じなら null
   */
  sheetTitle: string | null;
  /** 基金シートの枝番（同じ基金番号の中の通し番号） */
  branchNumber: number | null;
  ministry: string;
  owner: string;
  /** 保有法人の法人格（national-research-and-development-agency など） */
  ownerForm: string | null;
  sheetNumber: number | null;
  /** 運営の形態（reduce=取崩し型 など）・事業の形態（subsidy など） */
  operationForms: string[];
  businessForms: string[];
  createdYear: number | null;
  /** 終了予定日・新規受付の終了日（YYYY-MM-DD） */
  endDate: string | null;
  newApplicationEndDate: string | null;
  /** 基金で行う必要性の理由（府省の記載） */
  necessity: string | null;
  /** 保有割合の算定根拠（府省の記載） */
  ownershipBasis: string | null;
  inspection: FundInspectionFlags;
  /** 点検結果の記載（低執行の理由・調査結果など） */
  inspectionNote: string | null;
  overviewUrl: string | null;
  compositions: FundComposition[];
  /** 造成元・関連の事業（予算事業ID） */
  relatedPids: string[];
  /** 造成元・関連の事業の名前と、その事業が載っている最新のシート年度（サンキー図はその年度で開く） */
  relatedProjects: { pid: string; name: string; sheetYear: number }[];
  /** シート年度の古い順 */
  years: FundYear[];
}

export interface FundsFile {
  metadata: { generatedAt: string; sheetYears: number[]; source: string; notes: string[] };
  funds: Fund[];
}

/** 基金シートの支出先の1グループ（A・B…のブロック）。グループ間のつながりは基金シートに記載が無い */
export interface FundPaymentGroup {
  /** 表示記号（A・B…） */
  code: string;
  name: string;
  /** 府省の記載した概要（長いものは切り詰め） */
  overview: string | null;
  /** グループの支払額の合計（円）。負の値が混ざる記載は null */
  total: number | null;
  /** 支払先がすべて基金の保有法人自身（国からの交付を受ける段階・基金の管理）。基金から外へ出た支払いではない */
  self: boolean;
  payees: FundPayee[];
}

export interface FundPayee {
  name: string;
  corporateNumber: string | null;
  /** 支払額（円）。負の値が混ざる記載は null */
  amount: number | null;
  /** 契約方式のコード（subsidy・others など） */
  method: string | null;
  /** 「その他」にまとめられた行 */
  others: boolean;
}

export interface FundPaymentsFile {
  metadata: { generatedAt: string; sheetYears: number[]; source: string; notes: string[] };
  /** 基金の key（lineage_id）→ シート年度 → 支出先のグループ */
  funds: Record<string, Record<string, FundPaymentGroup[]>>;
}
