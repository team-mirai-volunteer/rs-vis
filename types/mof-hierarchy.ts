/**
 * MOF 事項別内訳の階層サンキーの型定義。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 の6列で、
 * 「国の予算がどの省庁のどの事業まで下りるか」を1枚で追えるようにする。
 *
 * データ源は `public/data/mof-jikou-{YEAR}.json`（事項別内訳）。専用の生成物は持たない。
 */

import type { MOFAccountType, MOFBudgetType, MOFJikouItem } from './mof-jikou';
import type { SankeyLink, SankeyNode } from './sankey';

/** 列。左から右へ並ぶ順に番号を振る */
export const MOF_HIERARCHY_COLUMNS = [
  'total',
  'ministry',
  'organization',
  'subAccount',
  'section',
  'item',
] as const;

export type MOFHierarchyColumn = (typeof MOF_HIERARCHY_COLUMNS)[number];

export const MOF_HIERARCHY_COLUMN_LABELS: Record<MOFHierarchyColumn, string> = {
  total: '予算合計',
  ministry: '所管',
  organization: '組織/特会',
  subAccount: '勘定/業務',
  section: '項',
  item: '事項',
};

/**
 * 集約ノードの名前に使う単位。
 *
 * 「その他」ではなく「41組織」「1,672事項」と件数で出す（/sankey-svg の作法）。
 * 溢れた分だと分かるだけの「その他」より、何件をまとめたのかが読めるほうが
 * 図の外に出ている量を把握しやすい。
 */
export const MOF_HIERARCHY_AGGREGATE_UNITS: Record<MOFHierarchyColumn, string> = {
  total: '件',
  ministry: '所管',
  organization: '組織',
  subAccount: '勘定',
  section: '項',
  item: '事項',
};

/** ノードに添える詳細 */
export interface MOFHierarchyNodeDetails {
  column: MOFHierarchyColumn;
  /** TopN から溢れた分をまとめたノードか */
  aggregated?: boolean;
  /**
   * その列に値を持たない枝の通過点か。
   * 一般会計や勘定を持たない特別会計は勘定列を素通りするが、
   * 何も置かないと帯がその列の実ノードを横切って重なる。
   * 場所だけ確保する透明なノードとして置き、描画では箱もラベルも出さない。
   */
  passThrough?: boolean;
  /** まとめた元の件数（集約ノードのみ） */
  aggregatedCount?: number;
  /** まとめた中身の上位（集約ノードのみ・金額の大きい順） */
  aggregatedTop?: Array<{ name: string; amount: number }>;
  /** 会計区分。所管より下の列では枝ごとに1つに定まる */
  accountType?: MOFAccountType;
  /** 事項ノードの説明（所掌事務・根拠法）。予算書の「説明」欄 */
  description?: string;
  /** 項ノードの項コード */
  sectionCode?: string;
  /** 事項ノードの主要経費別分類名 */
  majorExpenseName?: string;
}

export type MOFHierarchyNode = SankeyNode & {
  name: string;
  details: MOFHierarchyNodeDetails;
};

/**
 * ラベルをどこまで出すか。
 * all   = すべてのノードに名前を出す。読み落としは無いが図は縦に長くなる
 * major = 名前が収まる大きさのノードだけに出す。詰めて全体を見渡せる
 */
export type LabelDensity = 'major' | 'all';

/**
 * 絞り込みパネルの UI 状態。
 *
 * /sankey-svg のフィルタパネルと同じ発想の条件セット（事業名/支出先名 →
 * 項名/事項名、省庁 → 所管、会計、予算額の範囲）。金額はテキストで持つ
 * （「100億」のような単位付き入力を許すため）。API へ渡す前に yen へ解決する。
 */
export interface MOFHierarchyFilterState {
  /** 所管名（政府関係機関は「政府関係機関」等の会計区分ラベル） */
  ministries: string[];
  accountTypes: MOFAccountType[];
  sectionQuery: string;
  sectionRegex: boolean;
  itemQuery: string;
  itemRegex: boolean;
  /** 単位付きテキスト入力（例: 「100億」）。未確定時は空文字 */
  minAmountText: string;
  maxAmountText: string;
}

export const MOF_HIERARCHY_FILTER_DEFAULT: MOFHierarchyFilterState = {
  ministries: [],
  accountTypes: [],
  sectionQuery: '',
  sectionRegex: false,
  itemQuery: '',
  itemRegex: false,
  minAmountText: '',
  maxAmountText: '',
};

/** 何か1つでも条件が指定されているか */
export function hasActiveMOFHierarchyFilterState(state: MOFHierarchyFilterState): boolean {
  return (
    state.ministries.length > 0 ||
    state.accountTypes.length > 0 ||
    state.sectionQuery.trim() !== '' ||
    state.itemQuery.trim() !== '' ||
    state.minAmountText.trim() !== '' ||
    state.maxAmountText.trim() !== ''
  );
}

/** 列ごとの TopN。指定の無い列は集約しない */
export type MOFHierarchyTopN = Partial<Record<MOFHierarchyColumn, number>>;

/**
 * 列ごとの表示開始位置（0始まり）。
 * TopN だけだと上位しか見られず、41位以降は集約の中に消えたまま辿れない。
 * 窓をずらして下位も見られるようにする（/sankey-svg のオフセットと同じ）。
 */
export type MOFHierarchyOffset = Partial<Record<MOFHierarchyColumn, number>>;

/** 会計区分ごとの内訳。何が収録されているかを見出しに出すために持つ */
export interface MOFHierarchyAccountSummary {
  accountType: MOFAccountType;
  label: string;
  count: number;
  amount: number;
}

export interface MOFHierarchyData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    /** 選択中の予算種別 */
    budgetType: MOFBudgetType;
    /** その年度に収録されている予算種別 */
    budgetTypes: MOFBudgetType[];
    /** 収録済みの会計年度（新しい順） */
    availableYears: number[];
    /** 図に出ている事項の合計（円）。会計区分をまたぐ単純合計 */
    total: number;
    /** 図に出ている事項の件数 */
    itemCount: number;
    /** 適用した TopN（列ごとの表示件数の上限） */
    topN: MOFHierarchyTopN;
    /** 適用した表示開始位置。行き過ぎた指定は丸めた後の値が入る */
    offset: MOFHierarchyOffset;
    /**
     * 列ごとの候補件数。
     * 上流の列を絞ると下流の候補も減るので、画面が出す「◯〜◯ / 全◯件」は
     * この値を使う。集約ノードと通過ノードは数えない
     */
    columnCounts: Partial<Record<MOFHierarchyColumn, number>>;
    /**
     * 所管名の全件（フィルタ適用前）。
     * 絞り込みパネルの所管選択は、フィルタ後の browse から作ると
     * 選んだ所管以外が候補から消えてしまう（他の所管を追加で選べなくなる）ため、
     * フィルタとは独立にこちらを使う
     */
    ministries: string[];
    unit: 'yen';
    notes: string[];
  };
  /** 会計区分ごとの内訳（金額の大きい順） */
  accounts: MOFHierarchyAccountSummary[];
  sankey: {
    nodes: MOFHierarchyNode[];
    links: SankeyLink[];
  };
  /**
   * サイドパネルの一覧・タブ専用の全ノード（TopNで絞る前）。
   *
   * /sankey-svg は常にフルデータをパネル用に保持し、図の集約とは独立して
   * 全件を辿れる。sankey（図の表示用）は TopN で絞ってあるが、パネルは
   * こちらを見るので集約ノードとして畳まれることなく個々に選べる
   */
  browse: {
    nodes: MOFHierarchyNode[];
    links: SankeyLink[];
  };
}

/** 組み立てに使う入力。ローダから渡す */
export type MOFHierarchyInput = Pick<MOFJikouItem, never> & MOFJikouItem;

/** 項名／事項名の絞り込み条件（サーバ側フィルタ用） */
export interface MOFHierarchyNameFilter {
  query: string;
  /** 正規表現として解釈するか。既定は部分一致 */
  regex?: boolean;
}

/** サーバ側フィルタの条件（`filterMOFJikouItems` の入力） */
export interface MOFHierarchyFilter {
  /** 所管名（政府関係機関は機関名）。空配列・未指定は絞らない */
  ministries?: string[];
  /** 会計区分。空配列・未指定は絞らない */
  accountTypes?: MOFAccountType[];
  /** 項名 */
  sectionName?: MOFHierarchyNameFilter;
  /** 事項名 */
  itemName?: MOFHierarchyNameFilter;
  /** 事項の金額（円）の下限 */
  minAmount?: number | null;
  /** 事項の金額（円）の上限 */
  maxAmount?: number | null;
}
