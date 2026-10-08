/** 独立行政法人のセグメントシート（RSシステム sheet_type=SS）。生成は scripts/generate-agency-segments.ts */
import type { FundPaymentGroup } from './funds';

export interface AgencySegment {
  /** シートの id（年度ごと） */
  id: string;
  /** 年度をまたいだ識別子（lineage_id） */
  lineage: string;
  /** シート年度。前年度の執行額は年度 N−1 の実績 */
  sheetYear: number;
  name: string;
  agency: string;
  ministry: string;
  /** セグメントの区切り方（例：中期目標単位でのセグメント） */
  concept: string | null;
  overview: string | null;
  /** 前年度の執行額（円）。負の値が混ざる記載は null */
  execution: number | null;
  /** 収入の当初予算額・支出予算額（円） */
  revenueBudget: number | null;
  expenditureBudget: number | null;
  /** 対応するレビューシートの事業（予算事業ID） */
  pids: number[];
  /** sheet: シートに記載された対応（ss-link-base） / name: 法人名＋運営費交付金の事業名で1件に絞れた対応 */
  linkBasis: 'sheet' | 'name' | null;
  groups: FundPaymentGroup[];
}

export interface AgencySegmentsFile {
  metadata: { generatedAt: string; sheetYears: number[]; source: string; notes: string[] };
  segments: AgencySegment[];
  /** 予算事業ID → セグメントの id */
  byPid: Record<string, string[]>;
}
