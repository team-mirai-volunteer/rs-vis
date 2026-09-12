/**
 * Supabase の service role クライアント（サーバ専用）。
 *
 * 機能のオン/オフは専用フラグではなく env の有無で決める（設計: コメント機能設計 §環境変数）。
 * NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が揃っていなければ機能は無効で、
 * API は素の 404 を返す。service role キーはクライアントへ絶対に出さないこと。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function serviceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** コメント機能が有効か（必要な env が揃っているか） */
export function isCommentsEnabled(): boolean {
  return Boolean(supabaseUrl() && serviceRoleKey());
}

/** service role クライアント。無効環境では null */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * レート制限・荒らし対応用の IP ハッシュ。生 IP は保存しない。
 * ソルトは COMMENTS_IP_SALT があればそれ、無ければ service role キーから派生させる
 * （キーはサーバ専用の秘匿値なので外部からハッシュを逆算・照合できない）。
 */
export async function hashClientIp(ip: string): Promise<string> {
  const salt = process.env.COMMENTS_IP_SALT || serviceRoleKey() || '';
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
