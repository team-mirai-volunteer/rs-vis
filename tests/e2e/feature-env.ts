import { loadEnvConfig } from '@next/env';

// webServer（next dev / start）と同じ .env* を読み、テスト側でも機能の有無を判定できるようにする
loadEnvConfig(process.cwd());

/**
 * 事業コメント（AIインタビュー）の UI が出る環境か。app/lib/feature-flags.ts の
 * FEATURE_PROJECT_COMMENTS と同じ条件。無効な環境ではボタン自体が無いため、関連テストはスキップする。
 */
export const COMMENTS_ENABLED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const COMMENTS_DISABLED_REASON = 'NEXT_PUBLIC_SUPABASE_URL が未設定のため事業コメント機能が無効';
