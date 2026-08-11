import type { NextConfig } from "next";

/**
 * CSP（Content-Security-Policy）。目的は XSS 成立時の被害限定、特に BYOK の
 * APIキー（IndexedDB保存）の外部送信遮断（docs/ai-chat-architecture-guide.md「2. API キーの取り扱い規律」）。
 *
 * - connect-src: 自オリジン + OpenRouter（BYOKチャットのブラウザ直接呼び出し）のみ。
 *   XSS が成立しても fetch/XHR/sendBeacon での任意ホストへの送出を遮断する（本命の効果）
 * - script-src 'unsafe-inline': Next.js の hydration インラインスクリプトに必要
 *   （静的ページ主体のため per-request nonce は使えない）。スクリプト注入自体の防御は
 *   React の既定エスケープ + react-markdown（生HTML非描画）が一次防御
 * - style-src 'unsafe-inline': コンポーネント内 <style> タグ（chat-markdown 等）と
 *   インライン style 属性に必要
 * - 外部フォント・外部画像・worker は不使用（実測）のため許可しない
 */
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://openrouter.ai",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    // dev は HMR/React Refresh が eval・ws を使うため付与しない（本番のみ）
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP_HEADER },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
  // データ JSON の関数同梱はトレーサーの推測に任せず明示制御する。
  // 生 .json（展開後 96MB級）が同梱されると Vercel の関数上限 250MB を超えるため
  // （PR #259 で /api/ai/sankey-chat が実測 270MB でデプロイ失敗）、
  // 全関数から public/data を除外し、prebuild が data/server/ に同期した
  // .gz（全ファイル合計 ~35MB）+ 小容量 mof raw だけを同梱する。
  // 注意: Next の実装上、excludes は includes 適用後の結合結果に掛かるため、
  // 除外ツリー（public/data）内のファイルを include で残すことはできない。
  // include は必ず別ツリー（data/server）を指すこと（scripts/decompress-data.sh 参照）。
  // サーバ側ローダは public/data → data/server の順で探索する（app/lib/api/data-file.ts）。
  // 検証: npm run build 後に npm run check-traces（scripts/check-function-traces.mjs）。
  outputFileTracingExcludes: {
    // data/usage は dev 専用の利用ログ（usage-log.ts が参照するためトレースに載るが同梱不要）
    '*': ['./public/data/**', './data/usage/**'],
  },
  outputFileTracingIncludes: {
    '*': ['./data/server/**'],
  },
  transpilePackages: [
    '@nivo/sankey',
    '@nivo/core',
    '@nivo/colors',
    '@nivo/legends',
    '@nivo/text',
    '@nivo/theming',
    '@nivo/tooltip',
  ],
};

export default nextConfig;
