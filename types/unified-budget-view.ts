/**
 * 統合ビュー（/budget-sankey）の表示側の型。
 *
 * 生成物 `UnifiedGraph`（types/unified-budget.ts）を、列の畳み込み・絞り込み・TopN 集約を
 * 通して図に出せる形（`UnifiedViewNode` + `SankeyLink`）にしたもの。
 * 変換は app/lib/unified-budget/*.ts の純関数、描画は client/components/unified-budget/。
 */

import type { SankeyLink, SankeyNode } from './sankey';
import type { UnifiedColumn, UnifiedNode, UnifiedProgramKind } from './unified-budget';

/** 表示ノードに添える詳細。元ノードの属性をそのまま持ち、集約・畳み込みの情報を足す */
export interface UnifiedViewDetails extends Omit<UnifiedNode, 'id' | 'name' | 'value' | 'col'> {
  /** Outgoing spending flow, which can exceed the selected budget basis. */
  spendingFlow?: number;
  column: UnifiedColumn;
  /** TopN から溢れた分をまとめたノードか */
  aggregated?: boolean;
  /** まとめた元の件数（集約ノードのみ） */
  aggregatedCount?: number;
  /** まとめた中身の上位（集約ノードのみ・金額の大きい順） */
  aggregatedTop?: Array<{ id: string; name: string; amount: number }>;
}

export type UnifiedViewNode = SankeyNode & {
  name: string;
  value: number;
  details: UnifiedViewDetails;
};

export interface UnifiedViewGraph {
  nodes: UnifiedViewNode[];
  links: SankeyLink[];
}

/** 列ごとの表示数（TopN）。指定の無い列は既定値（DEFAULT_UNIFIED_TOP_N）、0 は無制限 */
export type UnifiedTopN = Partial<Record<UnifiedColumn, number>>;
/** 列ごとの表示開始位置（0始まり） */
export type UnifiedOffset = Partial<Record<UnifiedColumn, number>>;

/** 図の絞り込み */
export interface UnifiedViewFilter {
  /** 国債整理基金特会・交付税特会（collapsedByDefault の会計）を含めるか。既定 false */
  includeCollapsedAccounts: boolean;
  /** 非事業支出（繰入・国債費・地方財政移転・予備費・人件費）と未突合のノードを出すか。既定 true */
  showNonRs: boolean;
  /** 所管の絞り込み（空なら全て） */
  ministries: string[];
  /** 会計区分の絞り込み（空なら全て） */
  accountTypes: Array<'general' | 'special'>;
  /** 事業名・ノード名の部分一致（空なら無し）。全列のノードが対象で、一致したノードの上流・下流だけを残す */
  nameQuery: string;

  // ---- 以下は /sankey-svg から移植した絞り込み（RS事業・支出先が対象） ----

  /** 事業の予算額（事業列の値）の下限・上限。金額の文字列（"100億" 等。parseAmountToYen で解釈）。空なら無し */
  budgetMin: string;
  budgetMax: string;
  /** 事業の支出額（事業(支出)列の値）の下限・上限。金額の文字列。空なら無し */
  spendingMin: string;
  spendingMax: string;
  /** 事業名の絞り込み（RS事業ノードのみ対象）。空なら無し */
  projectQuery: string;
  /** projectQuery を正規表現（大文字小文字を区別しない）として扱う */
  projectRegex: boolean;
  /** 支出先名の絞り込み（支出先ノードのみ対象）。一致しない支出先を落とし、支出先が無くなった事業も落とす。空なら無し */
  recipientQuery: string;
  /** recipientQuery を正規表現として扱う */
  recipientRegex: boolean;
  /**
   * 支出先名の絞り込みで「再委託先も含める」（/sankey-svg の fnrs）。
   * オンのときは事業単位の判定になり、直接支出先または再委託先（subcontractRecipients）のどちらかに一致する事業を残す。
   * 支出先ノード自体は名前で隠さない
   */
  recipientIncludeSub: boolean;
  /** 再委託の有無。has = 再委託あり（subcontractMinDepth 以上）、none = 再委託の記載なし */
  subcontract: 'any' | 'has' | 'none';
  /** subcontract = 'has' のときの階層の下限（2 = 再委託、3 = 再々委託…）。既定 2 */
  subcontractMinDepth: number;
  /** 政策評価スコアの範囲（0〜100）。総合点 o・費用対内容 x・必要性 n。空なら無し */
  scoreO: UnifiedScoreRange;
  scoreX: UnifiedScoreRange;
  scoreN: UnifiedScoreRange;
}

/** スコア範囲（0〜100 の数値文字列。空欄 = 指定なし） */
export interface UnifiedScoreRange {
  min: string;
  max: string;
}

export const UNIFIED_SCORE_RANGE_EMPTY: UnifiedScoreRange = { min: '', max: '' };

export const UNIFIED_FILTER_DEFAULT: UnifiedViewFilter = {
  includeCollapsedAccounts: false,
  showNonRs: true,
  ministries: [],
  accountTypes: [],
  nameQuery: '',
  budgetMin: '',
  budgetMax: '',
  spendingMin: '',
  spendingMax: '',
  projectQuery: '',
  projectRegex: false,
  recipientQuery: '',
  recipientRegex: false,
  recipientIncludeSub: false,
  subcontract: 'any',
  subcontractMinDepth: 2,
  scoreO: UNIFIED_SCORE_RANGE_EMPTY,
  scoreX: UNIFIED_SCORE_RANGE_EMPTY,
  scoreN: UNIFIED_SCORE_RANGE_EMPTY,
};

export const hasScoreRange = (r: UnifiedScoreRange) => r.min.trim() !== '' || r.max.trim() !== '';

export function hasActiveUnifiedFilter(f: UnifiedViewFilter): boolean {
  return (
    f.includeCollapsedAccounts !== UNIFIED_FILTER_DEFAULT.includeCollapsedAccounts ||
    f.showNonRs !== UNIFIED_FILTER_DEFAULT.showNonRs ||
    f.ministries.length > 0 ||
    f.accountTypes.length > 0 ||
    f.nameQuery.trim() !== '' ||
    f.budgetMin.trim() !== '' ||
    f.budgetMax.trim() !== '' ||
    f.spendingMin.trim() !== '' ||
    f.spendingMax.trim() !== '' ||
    f.projectQuery.trim() !== '' ||
    f.recipientQuery.trim() !== '' ||
    f.subcontract !== 'any' ||
    hasScoreRange(f.scoreO) ||
    hasScoreRange(f.scoreX) ||
    hasScoreRange(f.scoreN)
  );
}

/** 政策評価スコア（/api/policy-summary の items を絞り込みに必要な 3 値へ落としたもの）。キーは事業ID の文字列 */
export type UnifiedPolicyScores = Record<string, { o: number | null; x: number | null; n: number | null }>;

/** applyFilter に渡す外部データ */
export interface UnifiedFilterContext {
  /** 政策評価スコア。未取得（undefined）のときはスコアの絞り込みを効かせない（取得前に事業が消えるのを避ける） */
  policy?: UnifiedPolicyScores;
}

/** プリセット（表示する列の組み合わせ）。設計 3.1 */
export type UnifiedPreset = 'full' | 'rs' | 'mof' | 'section';

export const UNIFIED_PRESET_LABELS: Record<UnifiedPreset, string> = {
  full: '統合',
  rs: 'RSのみ',
  mof: '予算書のみ',
  section: '項→目→事業',
};

export const UNIFIED_PRESET_COLUMNS: Record<UnifiedPreset, UnifiedColumn[]> = {
  full: ['account', 'ministry', 'section', 'program', 'program-spending', 'recipient'],
  rs: ['ministry', 'program', 'program-spending', 'recipient'],
  mof: ['account', 'ministry', 'organization', 'section', 'program'],
  section: ['section', 'koumoku', 'program', 'program-spending', 'recipient'],
};

/** 列ごとの表示数の既定。0 は無制限 */
export const DEFAULT_UNIFIED_TOP_N: Record<UnifiedColumn, number> = {
  account: 0,
  ministry: 0,
  organization: 40,
  section: 40,
  koumoku: 40,
  program: 40,
  'program-spending': 40,
  recipient: 60,
};

/** 集約ノードの名前に使う単位（「41項」のように件数で出す） */
export const UNIFIED_AGGREGATE_UNITS: Record<UnifiedColumn, string> = {
  account: '会計',
  ministry: '所管',
  organization: '組織',
  section: '項',
  koumoku: '目',
  program: '事業',
  'program-spending': '事業',
  recipient: '支出先',
};

export const AGGREGATE_ID_PREFIX = '__others__';
export const aggregateId = (column: UnifiedColumn) => `${AGGREGATE_ID_PREFIX}${column}`;

export type { UnifiedColumn, UnifiedProgramKind };
