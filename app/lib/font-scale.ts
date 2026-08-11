/**
 * フォントスケール機構（Pure）。
 *
 * baseFontPx（ユーザーが調整する基準フォントサイズ）と FONT_SCALE_REFERENCE_PX（既定値）の比率で
 * 各 UI 要素の px 指定フォントサイズを比例拡縮する。サンキー（app/sankey-svg/page.tsx）発の仕組みを
 * 他ページ（例: /subcontracts/[projectId]）でも再利用できるよう切り出したもの。
 *
 * HTTP・React に依存しない Pure ヘルパーのため app/lib/ に置く（CLAUDE.md のレイヤー規約）。
 */

/** scaleFont の基準となる px 値（この値のとき等倍＝拡縮なし） */
export const FONT_SCALE_REFERENCE_PX = 12;

/**
 * 指定した baseFontPx に基づく scaleFont 関数を生成する。
 * 各ページの既定値定数（FONT_PX_DEFAULT）に適用して実際の描画フォントサイズを得る。
 */
export function createScaleFont(
  baseFontPx: number,
  referencePx: number = FONT_SCALE_REFERENCE_PX,
): (px: number) => number {
  const fontScale = baseFontPx / referencePx;
  return (px: number) => Math.max(1, Math.round(px * fontScale));
}
