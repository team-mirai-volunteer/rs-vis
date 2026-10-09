/**
 * LP で使う部品の見た目を 1 種類ずつに固定する（lp-production スキル「部品の一覧（最小）」）。
 * 文字リンク 1 種、開閉の見出し 1 種。page.tsx と PolicyCases.tsx で共有する。
 */

/** 文字リンク: ブランド文字色・太字・ホバーで下線。当たり判定だけ上下 8px 広げる（見た目は変えない） */
export const TEXT_LINK = 'inline-flex items-center gap-1 -my-2 py-2 text-sm font-bold text-primary-accent hover:underline';

/** 開閉（詳しく見る）の見出し: 文字リンクと同じ見た目 + 下向きの矢印 */
export const SUMMARY_LINK = 'inline-flex cursor-pointer list-none items-center gap-1 -my-2 py-2 text-sm font-bold text-primary-accent hover:underline [&::-webkit-details-marker]:hidden';
