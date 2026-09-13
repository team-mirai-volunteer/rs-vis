/**
 * 会計間の繰入（内部振替）の詳細ビュー用の型定義。
 *
 * 会計名・宛先名は年度により増減するため、固定のフィールドではなく
 * 名前と金額の組の配列で持つ（新設・廃止された特別会計に型変更なしで追随するため）。
 * 捕捉ロジックは docs/mof-budget-data-guide.md 6節。
 */

import type {
  MOFAmountGroup,
  MOFBudgetNodeDetails,
  MOFBudgetOverview,
} from './mof-budget-overview';
import type { SankeyNode, SankeyLink } from './sankey';

/** 繰入の1本 */
export interface MOFTransferFlow {
  /** 送り手の会計（`一般会計` または特別会計名） */
  from: string;
  /** 宛先。特別会計名を特定できたものはその名前、できないものは目名のまま */
  to: string;
  /** 予算書上の目名（`普通国債等償還財源等国債整理基金特別会計へ繰入` など） */
  label: string;
  /** 金額（円） */
  amount: number;
}

/** 特別会計1つぶんの財源内訳 */
export interface MOFAccountFunding {
  account: string;
  /** 歳入合計（円） */
  revenue: number;
  /** 他会計から受け入れた額（円） */
  transferIn: number;
  /** 自前財源（歳入 − 受入、円） */
  ownRevenue: number;
  /** 自前財源比率（0〜1） */
  ownRevenueRate: number;
  /** 款別の歳入内訳 */
  byCategory: MOFAmountGroup[];
}

/**
 * 特別会計の財源内訳ビューの API レスポンス。
 *
 * `MOFBudgetOverviewData` と同じくレイヤをまたぐ契約なので `types/` に置く
 * （生成は `app/lib/mof-transfer-sankey-generator.ts`）。
 */
export interface MOFTransferDetailData {
  metadata: MOFBudgetOverview['metadata'] & {
    /** 特別会計が他会計から受け入れた総額（円） */
    receivedTotal: number;
  };
  sankey: {
    nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[];
    links: SankeyLink[];
  };
  /** 会計別の財源内訳（歳入の大きい順） */
  funding: MOFAccountFunding[];
  /** 一般会計からの繰入の宛先別内訳 */
  flows: MOFTransferFlow[];
}
