/**
 * 支出先逆引きインデックス（recipient-index-{YEAR}.json）の型定義。
 * scripts/generate-recipient-index.ts が生成し、/api/recipients 系が読む。
 */

import type { BlockOriginKind } from '@/types/subcontract';

/** 上流（誰から委託されたか）。null = 事業（国）からの直接支出 */
export interface AppearanceUpstream {
  blockName: string;
  /** 上流ブロックの支出先が1者の場合のみそのキー。複数者は null */
  recipientKey: string | null;
}

/** 下流（このブロックが誰へ委託したか） */
export interface AppearanceDownstream {
  blockName: string;
  amount: number;
  recipientKeys: string[];
}

/** 支出先の1出現（事業×ブロック単位。Multi-block は行を分けて全件保持） */
export interface RecipientAppearance {
  pid: number;
  projectName: string;
  ministry: string;
  blockId: string;
  originKind: BlockOriginKind;
  amount: number;
  upstream: AppearanceUpstream | null;
  downstream: AppearanceDownstream[];
  /**
   * 元データで報告された生の法人番号。解決（誤記載統合・番号補完）で
   * このエントリのキーと異なる番号／欠落から付け替わった出現にのみ付与する
   * （正常な出現では省略）。元データ側の問題の切り分けに使う。
   * ""（空文字）= 元データで法人番号が欠落していたことを表す。
   */
  rawCorporateNumber?: string;
}

export interface RecipientMinistryTotal {
  ministry: string;
  directAmount: number;
  subcontractAmount: number;
  projectCount: number;
}

export interface RecipientEntry {
  /** 法人番号13桁 or "name:正規化名" */
  key: string;
  /** 代表表記（最頻出） */
  name: string;
  corporateNumber: string;
  /** 同一キーに紐づいた表記ゆれ（代表表記含む） */
  aliases: string[];
  totals: {
    directAmount: number;
    directCount: number;
    subcontractAmount: number;
    subcontractCount: number;
    // 注意: direct + subcontract の単純合算は二重計上の恐れがあるため total は持たない
  };
  byMinistry: RecipientMinistryTotal[];
  appearances: RecipientAppearance[];
}

export interface RecipientIndexMetadata {
  year: number;
  generatedAt: string;
  sourceFile: string;
  recipientCount: number;
  appearanceCount: number;
  notes: string[];
}

export interface RecipientIndex {
  metadata: RecipientIndexMetadata;
  recipients: Record<string, RecipientEntry>;
  /**
   * キー互換: 解決（誤記載統合・番号補完）で付け替わった旧キー → 現行キー。
   * 旧キーでの参照（流通URL・過去レポート）を現行エントリへ案内するために API が使う。
   */
  redirects: Record<string, string>;
}
