/**
 * 表示機能のフィーチャーフラグ（デプロイ単位）。
 *
 * コードは全環境に入れたうえで、公開先ごとに UI を出すかどうかだけを切り替える。
 * 開発元（marumie-rssystem）では有効、公開ミラー（rs-vis）では未設定＝無効にする。
 *
 * `NEXT_PUBLIC_` 接頭辞はビルド時にクライアントへ埋め込まれるための Next.js の規約。
 * 値は次のとおり評価する（未設定は無効）。
 *
 *   '1' | 'true'  → 有効
 *   それ以外・未設定 → 無効
 *
 * サーバ API（/api/ai/sankey-chat 等）はフラグで塞がない。UI を出さないだけで、
 * エンドポイント自体の有無は別の判断（公開ポリシー）に属するため。
 */

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/** AIチャットパネル（BYOK）を表示するか */
export const FEATURE_AI_CHAT = isEnabled(process.env.NEXT_PUBLIC_FEATURE_AI_CHAT);

/** 探索履歴・発見メモ（IndexedDB・ローカル保存）を表示するか */
export const FEATURE_EXPLORATION_HISTORY = isEnabled(
  process.env.NEXT_PUBLIC_FEATURE_EXPLORATION_HISTORY,
);
