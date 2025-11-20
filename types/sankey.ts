/**
 * Sankey図データ構造の型定義
 * @nivo/sankeyライブラリで使用
 */

export interface SankeyNode {
  id: string;
  nodeColor?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/**
 * TopN設定値の型
 */
export type TopNValue = 5 | 10 | 20 | 50;

/**
 * TopN設定のキー
 */
export type TopNSettingsKey = 'budget-drilldown' | 'spending-bottomup';
