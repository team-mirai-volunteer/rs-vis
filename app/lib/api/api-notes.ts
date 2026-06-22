/**
 * API応答に同梱する共通メタ情報（データ留意事項・年度検証）。
 * 全APIで metadata.notes として同じ文言を返し、AIエージェント等の誤読を防ぐ。
 */
import { NextResponse } from 'next/server';

export const SUPPORTED_YEARS = ['2024', '2025'] as const;
export type SupportedYear = (typeof SUPPORTED_YEARS)[number];

export const DEFAULT_YEAR: SupportedYear = '2024';

/** year パラメータの検証。未指定はデフォルト、対象外は null を返す（呼び出し側で400にする） */
export function parseYear(value: string | null): SupportedYear | null {
  if (value == null || value === '') return DEFAULT_YEAR;
  return (SUPPORTED_YEARS as readonly string[]).includes(value)
    ? (value as SupportedYear)
    : null;
}

/** 全API共通のデータ留意事項 */
export const COMMON_NOTES: readonly string[] = [
  '全金額は1円単位です（千円単位ではありません）',
  '事業年度YEARのデータは予算年度YEAR-1の実績を表します（例: 2024年度データ=2023年度予算の執行実績）',
  '対象は行政事業レビュー対象事業のみで、国の全予算の約27%です（国債費・地方交付税等は含みません）',
  '「その他」(支出先名がそのまま報告されたもの)と「その他の支出先」(表示件数制限からの集計ノード)は別物です',
];

/** 支出先（受領側）系APIに追加する留意事項 */
export const RECIPIENT_NOTES: readonly string[] = [
  '直接受注額と再委託受注額の合算は二重計上になります。常に分離して扱ってください',
  '同一支出先が1事業内の複数ブロックに出現する場合があります（appearancesは全件保持、集計済み値はtotalsを参照）',
];

/** 共通メタデータの組み立て */
export function buildMetadata(
  year: SupportedYear,
  extra?: Record<string, unknown>,
  extraNotes?: readonly string[],
): Record<string, unknown> {
  return {
    year: Number(year),
    unit: 'JPY',
    generatedAt: new Date().toISOString(),
    notes: [...COMMON_NOTES, ...(extraNotes ?? [])],
    ...extra,
  };
}

/**
 * 全APIルート共通のキャッシュヘッダ。
 * データはデプロイ時のみ更新されるため、CDNで1日キャッシュ + 1週間 stale 配信を許容する。
 */
export const API_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';

/**
 * 予期しない例外を 500 として返す共通ハンドラ。
 * 詳細はサーバーログにのみ記録し、クライアントには汎用文言を返す（内部情報の漏洩防止）。
 */
export function serverErrorResponse(context: string, e: unknown): NextResponse {
  console.error(`[${context}]`, e);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
