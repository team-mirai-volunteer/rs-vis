/**
 * Sankey図データ構造の型定義
 * @nivo/sankeyライブラリで使用
 */

export interface SankeyNode {
  /** Drawing capacity only; value remains the amount used for display and filtering. */
  layoutValue?: number;
  id: string;
  nodeColor?: string;
  name?: string;
  value?: number;
  type?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  /** 予算書の目→RS事業の帯が、項・目の空欄を補足情報などで補った推定の対応を含む（統合サンキー） */
  inferred?: 'note' | 'amount+name' | 'reviewed';
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
export type TopNSettingsKey = 'budget-drilldown' | 'spending-bottomup' | 'subcontract-recipients';
