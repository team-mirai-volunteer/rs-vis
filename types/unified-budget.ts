/**
 * 統合ビュー（/budget-sankey）用の統合グラフ。
 *
 * 国の歳出予算（一般会計＋特別会計）を MOF予算書の階層（会計→所管→組織/勘定→項→目）で流し、
 * 目から RS事業（→ 支出）へ、RS事業が無い分は非事業支出の区分または「未突合」へ落とす。
 * 設計: docs/tasks/20260913_0428_財務省予算書とRS事業の完全統合サンキー設計.md（3章）
 * 生成: scripts/generate-unified-budget-graph.ts、検証: scripts/validate-unified-budget-graph.ts
 *
 * 金額の基準:
 * - 会計〜目〜事業区分の流量は MOF目の `basisBudgetType`（既定: 当初予算）の金額。補正予算の目は
 *   「改予算額」で当初と識別子が一致しない目が多く（2024年度: 843件）、単純合算すると二重計上になる
 *   ため予算種別は1つに固定する。
 * - RS事業ノードの値は歳出予算現額（/sankey-svg と同じ）。目からの流入との差分（補正・繰越・予備費・
 *   未突合・2-1と2-2の差）は擬似ノード `outside` からの流入で釣り合わせる。
 * - 事業(支出)・支出先は sankey-svg-{RSシート年度}-graph.json をそのまま引き継ぐ（執行年度のみ）。
 */

import type { BudgetBreakdownItem, BudgetSummary } from './sankey-svg';
import type { MOFBudgetType } from './mof-jikou';
import type { MofRsAmountKind } from './mof-rs-kou-moku-linkage';

/** 列。左から右へ。ページ側は列単位で表示/非表示（畳み込み）できる */
export type UnifiedColumn =
  | 'account'
  | 'ministry'
  | 'organization'
  | 'section'
  | 'koumoku'
  | 'program'
  | 'program-spending'
  | 'recipient';

export const UNIFIED_COLUMNS: readonly UnifiedColumn[] = [
  'account',
  'ministry',
  'organization',
  'section',
  'koumoku',
  'program',
  'program-spending',
  'recipient',
] as const;

export const UNIFIED_COLUMN_LABELS: Record<UnifiedColumn, string> = {
  account: '会計',
  ministry: '所管',
  organization: '組織/勘定',
  section: '項',
  koumoku: '目',
  program: '事業',
  'program-spending': '事業(支出)',
  recipient: '支出先',
};

/**
 * 事業列（program）のノード種別。
 * - rs: RS事業（個別）
 * - transfer: 他会計へ繰入（使途別分類6。純計では控除される会計間重複）
 * - debt: 国債費（主要経費20）
 * - local-transfer: 地方交付税・地方特例交付金・地方譲与税（主要経費31/32/33）
 * - reserve: 予備費（主要経費98・目的別107〜110）
 * - personnel: 人件費・旅費（使途別分類1/2）
 * - unmatched: 上記のいずれでもなく RS事業も付かない残余（要精査。品質指標）
 * - outside: 擬似ノード。事業ノードの歳出予算現額と目からの流入の差分（補正・繰越・予備費等・未突合）
 */
export type UnifiedProgramKind =
  | 'rs'
  | 'transfer'
  | 'debt'
  | 'local-transfer'
  | 'reserve'
  | 'personnel'
  | 'unmatched'
  | 'outside';

export const UNIFIED_PROGRAM_KIND_LABELS: Record<UnifiedProgramKind, string> = {
  rs: 'RS事業',
  transfer: '他会計へ繰入',
  debt: '国債費',
  'local-transfer': '地方財政移転（交付税等）',
  reserve: '予備費',
  personnel: '人件費・旅費',
  unmatched: '未突合（RS事業なし・非事業でもない）',
  outside: '予算書外（補正・繰越・予備費等）／未突合分',
};

export interface UnifiedNode {
  id: string;
  col: UnifiedColumn;
  name: string;
  /** 円 */
  value: number;
  /** 事業列のみ。RS事業は 'rs'、擬似ノードは 'outside' */
  kind?: UnifiedProgramKind;
  /** account〜koumoku 列 */
  accountType?: 'general' | 'special';
  /** MOF所管（account〜koumoku 列、事業列のRS事業は rsMinistry を使う） */
  ministry?: string;
  /** 組織（一般会計）または特別会計名（特別会計） */
  organization?: string;
  subAccount?: string;
  sectionCode?: string;
  sectionName?: string;
  subItemCode?: string;
  subItemName?: string;
  majorExpenseCode?: string;
  purposeCode?: string;
  objectiveCode?: string;
  /** MOF予算書の出典ページ（目ノード） */
  sourceUrl?: string;
  /** RS事業（program / program-spending） */
  projectId?: number;
  /** RS側の府省庁名（MOF所管と異なることがある: 林野庁→農林水産省 等） */
  rsMinistry?: string;
  accountCategory?: 'general' | 'special' | 'both';
  budgetSummary?: BudgetSummary;
  /** 事業列のRS事業のみ。会計区分・歳出項目ごとの予算内訳（サイドパネルの予算・執行アコーディオン用） */
  budgetBreakdown?: BudgetBreakdownItem[];
  /**
   * 再委託ブロック階層数（事業列のRS事業のみ・2以上＝再委託ありの場合のみ）。
   * sankey-svg の project-budget ノード（subcontracts-{年度}.json の maxDepth）から引き継ぐ。
   * 未設定 = 再委託の記載なし。絞り込み（filter.subcontract）が使う
   */
  subcontractDepth?: number;
  /** 再委託ブロックの支出先名一覧（事業列のRS事業・再委託ありのみ）。支出先名の絞り込み「再委託先を含む」が使う */
  subcontractRecipients?: string[];
  /** 支出先ノード（sankey-svg から引き継ぎ） */
  representativeCorporateNumber?: string;
  corporateNumberCount?: number;
  /**
   * 既定で折り畳んで表示する会計（国債整理基金特別会計・交付税及び譲与税配付金特別会計）。
   * 展開しないと他の会計が視認できないほど大きい
   */
  collapsedByDefault?: boolean;
  /** 上流を持たない擬似ノード（列畳み込み時にそのまま残す） */
  standalone?: boolean;
}

export interface UnifiedEdge {
  source: string;
  target: string;
  /** 円 */
  value: number;
  /** 同一目に複数事業が付き合計が目額を超えたため比例縮小した（rawValue が縮小前） */
  isScaled?: boolean;
  rawValue?: number;
  /** 推定値（決算の按分など） */
  estimated?: boolean;
}

/**
 * 予算の基準（当初・補正・決算）。統合グラフは基準ごとに別ファイルとして生成する
 * （unified-budget-{年度}-{basis}-graph.json）。
 * - initial: MOF 当初予算の目額 / RS事業は当初予算
 * - supplementary: MOF 補正予算（第1号）の目額（改予算額。補正予算書に載る目のみ）/ RS事業は当初+補正
 * - settlement: MOF 決算の支出済歳出額 / RS事業は執行額
 * 目の識別子が予算種別間で完全には一致しない（補正は「…外N目」に束ねられる）ため、基準をまたいだ合成はしない
 */
export type UnifiedBasis = 'initial' | 'supplementary' | 'settlement';

export const UNIFIED_BASES: readonly UnifiedBasis[] = ['initial', 'supplementary', 'settlement'];

export const UNIFIED_BASIS_LABELS: Record<UnifiedBasis, string> = {
  initial: '当初予算',
  supplementary: '補正予算',
  settlement: '決算',
};

/** 列見出しに添える MOF 側の測定量 */
export const UNIFIED_BASIS_MOF_MEASURE: Record<UnifiedBasis, string> = {
  initial: '当初予算',
  supplementary: '補正後（改予算額）',
  settlement: '支出済額',
};

/** 列見出しに添える RS事業側の測定量（執行年度） */
export const UNIFIED_BASIS_RS_MEASURE: Record<UnifiedBasis, string> = {
  initial: '当初予算',
  supplementary: '当初＋補正',
  settlement: '執行額',
};

/** 基準 → MOF 予算種別 */
export const UNIFIED_BASIS_MOF_BUDGET_TYPE: Record<UnifiedBasis, MOFBudgetType> = {
  initial: '当初予算',
  supplementary: '補正予算（第1号）',
  settlement: '決算',
};

/** 年度ごとに生成済みの基準。決算は年度終了後、補正は補正予算成立後に増える */
export const UNIFIED_BASES_BY_YEAR: Record<number, readonly UnifiedBasis[]> = {
  2023: ['initial', 'supplementary', 'settlement'],
  2024: ['initial', 'supplementary', 'settlement'],
  2025: ['initial', 'supplementary'],
  2026: ['initial'],
};

export const unifiedGraphFileName = (budgetYear: number, basis: UnifiedBasis) => `unified-budget-${budgetYear}-${basis}-graph.json`;

export interface UnifiedGraphMetadata {
  /** 予算年度（MOF会計年度） */
  budgetYear: number;
  /** 予算の基準（当初・補正・決算）。旧ファイルには無い */
  basis?: UnifiedBasis;
  /** 基準の表示名（当初予算 / 補正予算 / 決算） */
  basisLabel?: string;
  /** RS事業ノードの測定量の表示名（執行年度のみ。当初予算 / 当初＋補正 / 執行額） */
  rsMeasureLabel?: string;
  /** 正としたRSシート年度 */
  rsSheetYear: number;
  /** 事業(支出)・支出先の列があるか（執行年度 = シート年度-1 のみ） */
  hasSpending: boolean;
  /** RS側金額の意味（'request' は翌年度要求額。要求→査定ビュー） */
  rsAmountKind: MofRsAmountKind;
  /** 会計〜目の流量の基準となるMOF予算種別 */
  basisBudgetType: MOFBudgetType;
  eraLabel: string;
  unit: 'yen';
  generatedAt: string;
  totals: {
    /** 会計列の合計（一般＋特別。会計間の繰入を含む重複込み） */
    gross: number;
    /** 他会計へ繰入（使途別分類6）の合計 */
    transfer: number;
    /** gross − transfer */
    net: number;
    /** 事業列のうちRS事業ノードに流れた額（目→事業） */
    rsLinked: number;
    /** RS事業ノードの値の合計（歳出予算現額。/sankey-svg の totalBudget と一致するはず） */
    rsProgram: number;
    /** 擬似ノード outside からの流入合計 */
    outside: number;
    /** 目→事業の縮小で切り捨てた額（RS側の計上が目額を超えた分） */
    scaledDown: number;
    /** 事業区分ごとの額 */
    byKind: Record<UnifiedProgramKind, number>;
    /** 参考: 政府関係機関（グラフには含めない） */
    agency: number;
    /** 参考: mof-budget-overview の純計（同じ年度があれば） */
    overviewNet: number | null;
  };
  counts: Record<UnifiedColumn, number> & { edges: number; scaledEdges: number };
  /** 既定で折り畳む会計ノードID */
  collapsedAccounts: string[];
  notes: string[];
}

export interface UnifiedGraph {
  metadata: UnifiedGraphMetadata;
  nodes: UnifiedNode[];
  edges: UnifiedEdge[];
}
