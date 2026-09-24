/**
 * /api/quality-sections の応答。予算書の「項」ごとに、その項に紐づく RS事業の政策評価を
 * RS 2-2 の計上額で加重平均したもの（/quality の「項」表示）。
 */

import type { PolicyAggregate } from '@/app/lib/unified-budget/policy-aggregate';

export interface QualitySectionItem extends PolicyAggregate {
  /** 統合ビュー（/budget-sankey）の項ノード ID。`sel=` に渡すとその項を選択した状態で開ける */
  id: string;
  accountType: 'general' | 'special';
  ministry: string;
  /** 一般会計は組織、特別会計は特会名 */
  organization: string;
  subAccount: string;
  sectionCode: string;
  sectionName: string;
  /** 項に紐づく RS事業の計上額合計（円。加重平均の重みの合計） */
  rsAmount: number;
  programs?: Array<{ pid: number; name: string; amount: number; score: number | null; recommendation: string | null }>;
}

export interface QualitySectionsResponse {
  /** /quality の年度（2026 は要求ベース） */
  year: string;
  /** 紐づけ表の予算年度（= year） */
  budgetYear: number;
  /** 採点結果のシート年度 */
  rsSheetYear: number;
  /** 重みの意味。'budget' は 2-2 の当初予算、'request' は翌年度要求額 */
  rsAmountKind: 'budget' | 'request';
  /** この年度に紐づけ表が無い場合 true（items は空） */
  unavailable: boolean;
  items: QualitySectionItem[];
  summary: {
    sectionCount: number;
    evaluatedSectionCount: number;
    programCount: number;
  };
}
