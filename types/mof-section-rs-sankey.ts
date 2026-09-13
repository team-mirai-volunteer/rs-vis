/**
 * MOF 予算 → 項 → RS紐づけサンキーの型定義。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → RS対象/RS対象外 の6列。
 * `/mof-hierarchy`（事項別内訳の階層サンキー）と同じ 項 までの5列に、事項の代わりに
 * 「その項に、RSへ紐づく目が1件でもあるか」を2ノードで示す列を足したもの。
 *
 * RS紐づけは事項別内訳（事項単位）ではなく目単位の紐づけ（`MofRsKouMokuLinkageRecord`）
 * にしか無いため、項の識別子（会計区分・予算種別・所管・組織/特会・勘定・項コード）に
 * 集約して項単位で判定する（事項単位より粗い判定になる）。
 *
 * データ源は `mof-jikou-{YEAR}.json`（事項別内訳）と
 * `mof-rs-kou-moku-linkage-{YEAR}.json`（目↔RS事業紐づけ）。専用の生成物は持たない。
 */

import type { MOFAccountType, MOFBudgetType } from './mof-jikou';
import type { SankeyLink, SankeyNode } from './sankey';

/** 列。左から右へ並ぶ順に番号を振る */
export const MOF_SECTION_RS_COLUMNS = [
  'total',
  'ministry',
  'organization',
  'subAccount',
  'section',
  'rsStatus',
] as const;

export type MOFSectionRsColumn = (typeof MOF_SECTION_RS_COLUMNS)[number];

export const MOF_SECTION_RS_COLUMN_LABELS: Record<MOFSectionRsColumn, string> = {
  total: '予算合計',
  ministry: '所管',
  organization: '組織/特会',
  subAccount: '勘定/業務',
  section: '項',
  rsStatus: 'RS事業',
};

/** 集約ノードの名前に使う単位（「41組織」のように件数で出す。/mof-hierarchy と同じ作法） */
export const MOF_SECTION_RS_AGGREGATE_UNITS: Record<MOFSectionRsColumn, string> = {
  total: '件',
  ministry: '所管',
  organization: '組織',
  subAccount: '勘定',
  section: '項',
  rsStatus: '事業',
};

export type MOFSectionRsStatus = 'linked' | 'unlinked';

/** ノードに添える詳細 */
export interface MOFSectionRsNodeDetails {
  column: MOFSectionRsColumn;
  /** TopN から溢れた分をまとめたノードか */
  aggregated?: boolean;
  /** その列に値を持たない枝の通過点か（/mof-hierarchy と同じ） */
  passThrough?: boolean;
  /** まとめた元の件数（集約ノードのみ） */
  aggregatedCount?: number;
  /** まとめた中身の上位（集約ノードのみ・金額の大きい順） */
  aggregatedTop?: Array<{ name: string; amount: number }>;
  /** 会計区分。所管より下の列では枝ごとに1つに定まる */
  accountType?: MOFAccountType;
  /** 項ノードの項コード */
  sectionCode?: string;
  /**
   * 項の合成キー（`MOFKouSectionSummary.id`）。section列のノードのみ持つ。
   * /api/mof-kou/detail?id= に渡すと、その項の目一覧・RS紐づけの詳細を取得できる
   */
  mofKouSectionId?: string;
  /** 項ノード配下にRS紐づく目が1件でもあるか。section列のノードのみ持つ */
  rsLinked?: boolean;
  /** 項自体の出典ページ番号（`MOFKouSectionSummary.page`）。section列のノードのみ持つ。突合できない場合は null */
  page?: number | null;
  /** page が null のときは空文字列。section列のノードのみ持つ */
  sourceUrl?: string;
  /**
   * rsStatus列のノードの種別。'linked' は個別のRS事業ノード、'unlinked' は
   * RS対象外（紐づく目が無い分・紐づく目はあるが本年度額に届かない分）
   */
  rsStatus?: MOFSectionRsStatus;
  /** RS事業のプロジェクトID。rsStatus列の個別事業ノードのみ持つ */
  projectId?: number;
}

export type MOFSectionRsNode = SankeyNode & {
  name: string;
  details: MOFSectionRsNodeDetails;
};

/**
 * 列ごとの TopN。指定の無い列は集約しない。rsStatus列では「表示するRS事業の件数」
 * を意味する（項ごとではなく列全体で、金額の大きい順。/mof-hierarchy と同じ考え方）
 */
export type MOFSectionRsTopN = Partial<Record<Exclude<MOFSectionRsColumn, 'total'>, number>>;

/**
 * 列ごとの表示開始位置（0始まり）。/mof-hierarchy と同じ考え方。
 * rsStatus列は対象外（個別のRS事業は「先頭からTopN件」のみで、位置替えは持たない）
 */
export type MOFSectionRsOffset = Partial<Record<Exclude<MOFSectionRsColumn, 'total' | 'rsStatus'>, number>>;

/** 会計区分ごとの内訳 */
export interface MOFSectionRsAccountSummary {
  accountType: MOFAccountType;
  label: string;
  count: number;
  amount: number;
}

export interface MOFSectionRsData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    budgetType: MOFBudgetType;
    budgetTypes: MOFBudgetType[];
    availableYears: number[];
    /** 図に出ている項の合計（円）。会計区分をまたぐ単純合計 */
    total: number;
    /** 図に出ている項の件数 */
    sectionCount: number;
    /** RS紐づけデータの対象年度（RS事業年度）。紐づけ未生成の年度は null */
    rsYear: number | null;
    /** 紐づけデータの突合範囲の説明（例: 「一般会計・特別会計・当初予算＋補正予算」） */
    linkageScope: string | null;
    topN: MOFSectionRsTopN;
    offset: MOFSectionRsOffset;
    columnCounts: Partial<Record<MOFSectionRsColumn, number>>;
    ministries: string[];
    unit: 'yen';
    notes: string[];
  };
  accounts: MOFSectionRsAccountSummary[];
  sankey: {
    nodes: MOFSectionRsNode[];
    links: SankeyLink[];
  };
  /**
   * サイドパネルの一覧・タブ専用の全ノード（TopNで絞る前）。
   * /mof-hierarchy と同じく、図の集約とは独立して全件を辿れる
   */
  browse: {
    nodes: MOFSectionRsNode[];
    links: SankeyLink[];
  };
}

/** 項名の絞り込み条件（サーバ側フィルタ用） */
export interface MOFSectionRsNameFilter {
  query: string;
  regex?: boolean;
}

/** サーバ側フィルタの条件（`filterMOFJikouItems` を再利用する） */
export interface MOFSectionRsFilter {
  ministries?: string[];
  accountTypes?: MOFAccountType[];
  sectionName?: MOFSectionRsNameFilter;
  minAmount?: number | null;
  maxAmount?: number | null;
}

/** 絞り込みパネルの UI 状態 */
export interface MOFSectionRsFilterState {
  ministries: string[];
  accountTypes: MOFAccountType[];
  sectionQuery: string;
  sectionRegex: boolean;
  minAmountText: string;
  maxAmountText: string;
}

export const MOF_SECTION_RS_FILTER_DEFAULT: MOFSectionRsFilterState = {
  ministries: [],
  accountTypes: [],
  sectionQuery: '',
  sectionRegex: false,
  minAmountText: '',
  maxAmountText: '',
};

export function hasActiveMOFSectionRsFilterState(state: MOFSectionRsFilterState): boolean {
  return (
    state.ministries.length > 0 ||
    state.accountTypes.length > 0 ||
    state.sectionQuery.trim() !== '' ||
    state.minAmountText.trim() !== '' ||
    state.maxAmountText.trim() !== ''
  );
}
