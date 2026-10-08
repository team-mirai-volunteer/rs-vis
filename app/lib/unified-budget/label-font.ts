/**
 * サンキー図のラベル文字サイズの既定値を、画面の大きさから決める（Pure 層）。
 *
 * 既定（13px）はフル HD（1920×1080）の表示領域を基準にしている。ノート PC（1366×768 など）では
 * 同じ 13px だと列に収まるラベルが減り、ノードの最小高さ（labelSlot）も相対的に大きくなるため、
 * 画面の高さ・幅の比で縮める。利用者が文字サイズを明示したとき（URL の fs）はこの値を使わない。
 */

/** フル HD の既定値。UnifiedSankeyChart の LABEL_FONT_PX_DEFAULT と同じ */
export const LABEL_FONT_PX_FULL_HD = 13;
/** 自動で縮める下限。これより小さいと和文が読みにくい */
export const LABEL_FONT_PX_AUTO_MIN = 10;
/** 基準の表示領域（ブラウザのツールバーを除いたフル HD の内側） */
const BASE_WIDTH = 1900;
const BASE_HEIGHT = 1000;

/** ブラウザの内側の幅・高さから、ラベル文字サイズの既定値（整数 px）を返す */
export function autoLabelFontPx(innerWidth: number, innerHeight: number): number {
  if (!(innerWidth > 0) || !(innerHeight > 0)) return LABEL_FONT_PX_FULL_HD;
  const ratio = Math.min(innerWidth / BASE_WIDTH, innerHeight / BASE_HEIGHT, 1);
  return Math.max(LABEL_FONT_PX_AUTO_MIN, Math.round(LABEL_FONT_PX_FULL_HD * ratio));
}
