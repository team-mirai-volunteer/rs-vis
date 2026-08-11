'use client';

/**
 * 年度セレクト。全ページ共通で PageNavMenu の左隣に置く。
 *
 * 以前はページごとに inline style と Tailwind が混在し、高さ 34/36/38px・
 * 文字 12/13px・枠線 2色・矢印がネイティブとカスタムで割れていた。
 * 見た目は PageNavMenu のボタン（h-9・rounded-lg・border-black/10・shadow-md）に揃える。
 *
 * 矢印は appearance:none ＋ 自前 SVG に統一する。ネイティブのままだと
 * ブラウザ・OS で形と幅が変わり、隣のメニューボタンと高さが揃わないため。
 */

export function YearSelect({
  value,
  onChange,
  years,
  theme = 'auto',
  fontPx,
  testId,
}: {
  value: string;
  onChange: (year: string) => void;
  years: readonly (string | number)[];
  /** 'light' はライト配色固定のページ（/sankey-svg 等）用。OSダーク時の浮きを防ぐ */
  theme?: 'auto' | 'light';
  /** フォントスケール対応ページ用。未指定なら text-xs 相当 */
  fontPx?: number;
  testId?: string;
}) {
  const dark = theme === 'auto';
  return (
    <div className="relative shrink-0">
      <select
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="年度"
        style={fontPx ? { fontSize: fontPx } : undefined}
        className={`h-9 cursor-pointer appearance-none rounded-lg border border-black/10 bg-white/90 pl-2.5 pr-7 text-xs text-neutral-700 shadow-md backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
          dark ? 'dark:border-white/10 dark:bg-neutral-900/90 dark:text-neutral-200' : ''
        }`}
      >
        {years.map(y => (
          <option key={y} value={String(y)}>{y}年度</option>
        ))}
      </select>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        height="14"
        width="14"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 fill-neutral-400 ${
          dark ? 'dark:fill-neutral-500' : ''
        }`}
      >
        <path d="M7 10l5 5 5-5z" />
      </svg>
    </div>
  );
}
