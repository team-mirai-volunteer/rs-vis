/**
 * ポインタのそばに出すフロート（ツールチップ・ホバーカード）の置き場所（Pure 層）。
 *
 * 基本はポインタの右に出す。右端に収まらないときは左に出す。
 * 画面が狭くて左右どちらにも収まらないときは、横は端に寄せ、縦はポインタの下（下に収まらなければ上）に出して、
 * ポインタ（見ている丸）をフロートで隠さないようにする。縦は常に上下の余白の内側に収める。
 */
export interface FloatPlacementInput {
  /** ポインタの位置（親要素内の座標） */
  x: number;
  y: number;
  /** フロートの大きさ */
  width: number;
  height: number;
  /** 親要素（絶対配置の基準）の大きさ */
  parentWidth: number;
  parentHeight: number;
  /** ポインタからの離し幅 */
  gap?: number;
  /** 端からの余白 */
  margin?: number;
  /** 左右に出すときの縦位置（ポインタの y からのずらし。既定は少し上） */
  sideOffsetY?: number;
}

export interface FloatPlacement {
  left: number;
  top: number;
  /** どちらに出したか（テスト・デバッグ用） */
  side: 'right' | 'left' | 'below' | 'above';
}

export function floatPlacement({ x, y, width, height, parentWidth, parentHeight, gap = 14, margin = 8, sideOffsetY = -60 }: FloatPlacementInput): FloatPlacement {
  const clampTop = (top: number) => Math.max(margin, Math.min(top, parentHeight - height - margin));
  const clampLeft = (left: number) => Math.max(margin, Math.min(left, parentWidth - width - margin));
  const right = x + gap;
  if (right + width <= parentWidth - margin) return { left: right, top: clampTop(y + sideOffsetY), side: 'right' };
  const left = x - gap - width;
  if (left >= margin) return { left, top: clampTop(y + sideOffsetY), side: 'left' };
  // 左右とも収まらない（狭い画面）: 横は端に寄せ、縦はポインタを避けて下か上に
  const below = y + gap;
  if (below + height <= parentHeight - margin) return { left: clampLeft(right), top: below, side: 'below' };
  return { left: clampLeft(right), top: Math.max(margin, y - gap - height), side: 'above' };
}
