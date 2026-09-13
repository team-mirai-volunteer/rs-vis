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
  /** 事業名・ノード名の部分一致（空なら無し） */
  nameQuery: string;
}

export const UNIFIED_FILTER_DEFAULT: UnifiedViewFilter = {
  includeCollapsedAccounts: false,
  showNonRs: true,
  ministries: [],
  accountTypes: [],
  nameQuery: '',
};

export function hasActiveUnifiedFilter(f: UnifiedViewFilter): boolean {
  return (
    f.includeCollapsedAccounts !== UNIFIED_FILTER_DEFAULT.includeCollapsedAccounts ||
    f.showNonRs !== UNIFIED_FILTER_DEFAULT.showNonRs ||
    f.ministries.length > 0 ||
    f.accountTypes.length > 0 ||
    f.nameQuery.trim() !== ''
  );
}

/** プリセット（表示する列の組み合わせ）。設計 3.1 */
export type UnifiedPreset = 'full' | 'rs' | 'mof' | 'section' | 'custom';

export const UNIFIED_PRESET_LABELS: Record<UnifiedPreset, string> = {
  full: '完全統合',
  rs: 'RSのみ',
  mof: '予算書のみ',
  section: '項→目→事業',
  custom: 'カスタム',
};

export const UNIFIED_PRESET_COLUMNS: Record<Exclude<UnifiedPreset, 'custom'>, UnifiedColumn[]> = {
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
