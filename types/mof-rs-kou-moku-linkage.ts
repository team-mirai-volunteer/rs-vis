/**
 * MOF目（科目別内訳） ↔ RS事業 紐づけデータの型定義。
 *
 * `types/mof-rs-linkage.ts`（MOF事項＝目的別の内訳 ↔ RS事業）と対になる、
 * MOF目＝性質別の内訳 ↔ RS事業 の紐づけ。RS の `2-2_予算・執行_予算種別・歳出予算項目` は
 * 一般会計なら 所管/組織・勘定/項/目、特別会計なら 所管/会計/勘定/項/目 を MOF の
 * 科目別内訳CSVと同じ語彙で持つため、事項と違って**名前照合ではなく完全一致キーで
 * 直接突き合わせられる**（実測: 一般会計・当初予算でRS行の92.7%・金額の97.9%、
 * 特別会計・当初予算で行の86.6%・金額の98.9%が一致。docs/tasks/参照）。
 * 政府関係機関はRSの `会計区分` に該当値が無く対象外。
 * 生成: scripts/generate-mof-rs-kou-moku-linkage.ts
 */

import type { MOFBudgetType, MOFKouMokuAccountType } from './mof-kou-moku';

/**
 * rsAmount の意味。'budget' は 2-2 の予算額（当初・補正）、'request' は翌年度要求額
 * （予算年度 = シート年度+1 の「要求→査定」対比）。UI はこれで「RS計上額」「RS要求額」を出し分ける
 */
export type MofRsAmountKind = 'budget' | 'request';

/** 紐づけ1件（事業×目のペア。1つの目に複数のRS事業が計上されることがある） */
export interface MofRsKouMokuLinkageRecord {
  projectId: number;
  projectName: string;
  projectMinistry: string;
  /** MOF目の合成キー（`MOFKouMokuItem.key`） */
  kouMokuKey: string;
  mofAccountType: MOFKouMokuAccountType;
  /**
   * MOF側の予算種別。RS側は「第N次補正予算」表記だが、ここはMOF側の
   * 「補正予算（第N号）」表記（対応関係は generate-mof-rs-kou-moku-linkage.ts 参照）。
   */
  mofBudgetType: MOFBudgetType;
  mofMinistry: string;
  /** 組織（一般会計）または特別会計名（特別会計） */
  mofOrganization: string;
  /** 勘定名（特別会計のみ。一般会計は空） */
  mofSubAccount: string;
  sectionCode: string;
  sectionName: string;
  subItemCode: string;
  subItemName: string;
  /** MOF目の本年度額（円）。決算では決算額（歳出予算額） */
  kouMokuAmount: number;
  /**
   * 当該事業・当該目に計上されたRS予算額（円）。同一キーに複数行あれば合算。
   * `carriedOverFrom` がある場合は元の予算側リンクのRS予算額をそのまま引き継いだもので、
   * この決算目に対応するRS側の実行額ではない（RSは項目別の決算・執行額を持たないため）。
   */
  rsAmount: number;
  /**
   * この決算目へのリンクが、同一識別子（会計区分・所管・組織/特会・勘定・項コード・
   * 目分類コード・目名。予算種別を除く）を持つ予算側（当初予算／補正予算）のリンクから
   * 引き継がれたものである場合、その元の予算種別。直接キー一致したリンクでは undefined。
   * RSは決算・執行実績を目単位で持たないため、決算目への紐づけは常にこの引き継ぎ経由になる。
   */
  carriedOverFrom?: MOFBudgetType;
  /**
   * 名前一致キーが同じで項・目コードが異なる目が複数あり、RS金額を目額比で按分したリンク。
   * RS側からはどの目か判別できないため、この rsAmount は按分値（推定）。
   */
  ambiguous?: boolean;
}

/** 事業ごとのRS歳出予算項目の合計（突合範囲内・予算年度の行のみ） */
export interface MofRsLinkageProjectTotal {
  projectId: number;
  projectName: string;
  projectMinistry: string;
  /** 2-2 の対象年度行の合計（一般＋特別会計。繰越・予備費等を含む） */
  rsAmountTotal: number;
  /** MOF目に紐づいた金額 */
  rsAmountLinked: number;
  /** 項・目はあるはずだがMOF目に一致しなかった金額（項・目空欄を含む） */
  rsAmountUnmatched: number;
  /**
   * 「前年度から繰越し」「予備費等N」の合計。RS側に項・目が無く原理的に突合不可。
   * 統合グラフで事業ノードへの「繰越・予備費等（予算書外）」流入として使う。要求モードでは常に0
   */
  rsAmountNoSubject: number;
}

/** RS側未一致の理由 */
export type MofRsUnmatchedReason =
  /** RS行の項または目が空欄（旧様式・独自科目）。突合の前提を満たさない */
  | 'rs-no-subject-code'
  /** 項・目はあるが、MOF側に同名キーの目が無い（表記差・年度差・RS側の独自科目） */
  | 'no-mof-match';

/** RS側未一致（事業×突合キーで集約） */
export interface MofRsLinkageUnmatchedRs {
  projectId: number;
  projectName: string;
  projectMinistry: string;
  accountCategory: string;
  rsBudgetType: string;
  jurisdiction: string;
  organizationAccount: string;
  account: string;
  subAccount: string;
  item: string;
  subItem: string;
  /** 歳出予算項目の補足情報（旧様式では「項名　目名」のテキストが入る） */
  note: string;
  rsAmount: number;
  rows: number;
  reason: MofRsUnmatchedReason;
}

/** MOF側未一致（突合対象の目のうちRS事業が1件も付かなかったもの） */
export interface MofRsLinkageUnmatchedMof {
  kouMokuKey: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  ministry: string;
  organization: string;
  subAccount: string;
  sectionCode: string;
  sectionName: string;
  subItemCode: string;
  subItemName: string;
  /** 主要経費別分類コード（非事業支出の判別に使う: 国債費20・地方交付税31 等） */
  majorExpenseCode: string;
  /** 使途別分類コード（1 人件費・6 他会計へ繰入 等） */
  purposeCode: string;
  objectiveCode: string;
  amount: number;
}

/** 出力 JSON 全体 */
export interface MofRsKouMokuLinkageData {
  metadata: {
    /** 予算年度 = MOF会計年度（西暦） */
    budgetYear: number;
    /** RS事業年度（シート年度）。`rsSheetYear` と同値（旧フィールド。/sankey-svg の yr パラメータに使う） */
    rsYear: number;
    /** 正としたRSシートの年度。予算年度 = シート年度-1（執行年度）・シート年度・シート年度+1（要求） */
    rsSheetYear: number;
    /**
     * rsAmount の意味。'budget' は 2-2 の予算額、'request' は翌年度要求額
     * （予算年度 = シート年度+1 の「要求→査定」対比。kouMokuAmount はMOF当初予算）
     */
    rsAmountKind: MofRsAmountKind;
    mofEraLabel: string;
    /** 突合範囲の説明 */
    scope: string;
    unit: 'yen';
    generatedAt: string;
    counts: {
      links: number;
      /** 突合範囲内のMOF目総数 */
      kouMokuTotal: number;
      /** 1件以上の事業に紐づいた目数 */
      kouMokuLinked: number;
      /** 突合範囲内のRS事業総数 */
      projectTotal: number;
      /** 1件以上の目に紐づいた事業数 */
      projectLinked: number;
      /** 突合範囲内のRS予算行総数 */
      rowsTotal: number;
      /** 完全一致キーで紐づいた行数 */
      rowsLinked: number;
      /** 同名キー衝突で按分したリンク数 */
      ambiguousLinks: number;
      /** 決算目へ引き継いだリンク数 */
      carriedOverLinks: number;
    };
    coverage: {
      /** 突合範囲内のRS予算総額（円。繰越・予備費等は含まない） */
      rsAmountTotal: number;
      /** 紐づいた予算額合計（円） */
      rsAmountLinked: number;
      /** 繰越・予備費等（項・目無し）の合計（円） */
      rsAmountNoSubject: number;
      /**
       * 突合対象のMOF目の総額と紐づいた額（円）を予算種別ごとに。
       * 補正予算の目額は改予算額（その号成立後の全体像）で当初と足すと二重計上になるため分けて持つ
       */
      kouMokuAmountByBudgetType: Partial<Record<MOFBudgetType, { total: number; linked: number; items: number; itemsLinked: number }>>;
    };
    /** 未一致の要約。全件はローカル生成の unmatched ファイル */
    unmatched: {
      rs: {
        pairs: number;
        byReason: Record<MofRsUnmatchedReason, { rows: number; amount: number }>;
        top: MofRsLinkageUnmatchedRs[];
      };
      mof: {
        items: number;
        amount: number;
        top: MofRsLinkageUnmatchedMof[];
      };
      file: string;
    };
    notes: string[];
  };
  /** 事業ごとの合計（突合範囲内の全事業。紐づかなかった事業も含む） */
  projects: MofRsLinkageProjectTotal[];
  links: MofRsKouMokuLinkageRecord[];
}

/** GET /api/mof-kou-moku/linkage のレスポンス */
export interface MofRsKouMokuLinkageResponse {
  available: boolean;
  rsYear: number | null;
  /** rsAmount の意味（未生成の年度は null） */
  rsAmountKind: MofRsAmountKind | null;
  links: MofRsKouMokuLinkageRecord[];
}
