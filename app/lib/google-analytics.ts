/** 本番の GA4 測定 ID。環境変数が空・不正なときはこれを使う。 */
export const DEFAULT_GA_MEASUREMENT_ID = 'G-R7STTQBRZJ';

const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

/**
 * GA4 測定 ID。`NEXT_PUBLIC_GA_MEASUREMENT_ID` があればそれを使い、
 * 未設定・空・形式が違うときは既定の本番プロパティに落とす。
 * 測定 ID は gtag のインラインスクリプトへ埋め込まれるため、`G-` 形式だけを通す。
 */
export function googleAnalyticsMeasurementId(
  value: string | undefined = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
): string {
  const trimmed = value?.trim();
  if (trimmed && GA_MEASUREMENT_ID_PATTERN.test(trimmed)) return trimmed;
  return DEFAULT_GA_MEASUREMENT_ID;
}

/** 本番 Vercel だけ計測する。preview・ローカルではタグを出さない。 */
export function isProductionAnalytics(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv === 'production';
}

/**
 * `/admin` ではタグを読み込まない。
 * パスが取れないときも読み込まない（管理画面かどうか判断できないため）。
 */
export function shouldLoadGoogleAnalytics(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname !== '/admin' && !pathname.startsWith('/admin/');
}
