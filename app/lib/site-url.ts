/**
 * サイトの公開URL（OGP/canonical・sitemap・robots の絶対URL基準）。
 *
 * 特定ドメインをソースに直書きしない。デプロイ先に追随させる:
 *   1. NEXT_PUBLIC_SITE_URL          … 明示指定があれば最優先
 *   2. VERCEL_PROJECT_PRODUCTION_URL … Vercel本番の安定ドメイン（推奨）
 *   3. VERCEL_URL                    … その他のVercelデプロイURL（preview等）
 *   4. http://localhost:3000         … ローカル開発フォールバック
 *
 * いずれも server 専用箇所（layout metadata / robots / sitemap）からのみ参照される。
 */
const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (vercelHost ? `https://${vercelHost}` : 'http://localhost:3000');
