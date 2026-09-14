'use client';

/**
 * サンキー系 SVG のラベル省略ヘルパ（統合ビュー / 再委託フロー図で共用）。
 */

/** 名前を max 文字に切る。切ったかどうかは呼び出し側が省略記号を描くために使う */
export function truncateName(name: string, max: number): { text: string; truncated: boolean } {
  return name.length > max ? { text: name.slice(0, max), truncated: true } : { text: name, truncated: false };
}

/**
 * 省略記号。Noto Sans JP の「…」は全角幅で前後に空きが出て 1 文字ぶん場所を食うので、
 * textLength で半角幅に詰めて描く（隣のラベルと被る幅を減らす）
 */
export function Ellipsis({ fontPx }: { fontPx: number }) {
  return (
    <tspan textLength={fontPx * 0.5} lengthAdjust="spacingAndGlyphs">
      …
    </tspan>
  );
}
