/**
 * 項単位「項→目→RS事業→支出先」サンキーの型定義。
 *
 * `/mof-kou`の1項について、その項の目が計上されているRS事業と、RS事業の
 * 支出先（1階層目のみ。再委託先は対象外）までを1枚のサンキーで見せる。
 * 詳細は docs/tasks/20260904_0759_項単位の目RS事業支出先サンキー設計.md 参照。
 */

import type { SankeyLink, SankeyNode } from './sankey';

/** 列。左から右へ並ぶ順に番号を振る。項自体は1ノードのroot */
export const MOF_KOU_SANKEY_COLUMNS = ['section', 'koumoku', 'rsStatus', 'recipient'] as const;

export type MOFKouSankeyColumn = (typeof MOF_KOU_SANKEY_COLUMNS)[number];

export const MOF_KOU_SANKEY_COLUMN_LABELS: Record<MOFKouSankeyColumn, string> = {
  section: '項',
  koumoku: '目',
  rsStatus: 'RS事業',
  recipient: '支出先',
};

/** 集約ノードの名前に使う単位（「41事業」のように件数で出す。/mof-sankey と同じ作法） */
export const MOF_KOU_SANKEY_AGGREGATE_UNITS: Record<MOFKouSankeyColumn, string> = {
  section: '件',
  koumoku: '目',
  rsStatus: '事業',
  recipient: '先',
};

/** 列ごとのTopN既定値（/mof-sankey の DEFAULT_TOP_N と同じ40） */
export const DEFAULT_MOF_KOU_SANKEY_TOP_N = 40;

/** ノードに添える詳細 */
export interface MOFKouSankeyNodeDetails {
  column: MOFKouSankeyColumn;
  /** TopN から溢れた分をまとめたノードか */
  aggregated?: boolean;
  /** まとめた元の件数（集約ノードのみ） */
  aggregatedCount?: number;
  /** まとめた中身の上位（集約ノードのみ・金額の大きい順） */
  aggregatedTop?: Array<{ name: string; amount: number }>;
  /** 目の合成キー（MOFKouMokuItem.key）。koumoku列のノードのみ持つ */
  kouMokuKey?: string;
  /** RS事業のプロジェクトID。rsStatus列のノードのみ持つ */
  projectId?: number;
}

export type MOFKouSankeyNode = SankeyNode & {
  name: string;
  details: MOFKouSankeyNodeDetails;
};

export interface MOFKouSankeyData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    budgetType: string;
    /** 項の合成キー（MOFKouSectionSummary.id） */
    sectionId: string;
    sectionName: string;
    ministry: string;
    /** RS紐づけデータの対象年度（RS事業年度）。紐づけ未生成の年度は null */
    rsYear: number | null;
    /** 図に出ている項の合計（円）。項自体の本年度額 */
    total: number;
    topN: Record<Exclude<MOFKouSankeyColumn, 'section'>, number>;
    columnCounts: Partial<Record<MOFKouSankeyColumn, number>>;
    unit: 'yen';
  };
  sankey: {
    nodes: MOFKouSankeyNode[];
    links: SankeyLink[];
  };
  /** サイドパネルの一覧・タブ専用の全ノード（TopNで絞る前。/mof-sankey と同じ考え方） */
  browse: {
    nodes: MOFKouSankeyNode[];
    links: SankeyLink[];
  };
}
