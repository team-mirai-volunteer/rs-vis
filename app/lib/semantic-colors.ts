/**
 * 意味色の正典（single source of truth）。
 *
 * 予算・支出フローに現れる4つの意味に、それぞれ1色を割り当てる。
 * メインSankey（/sankey-svg）と再委託ビュー（/subcontracts）で
 * 同じ意味には同じ色が出るよう、両者はこの定義を参照する。
 *
 * デザイン原則:
 * - カード/ノードの背景は白。意味色はタグ・左ボーダー・リボンだけが持つ。
 * - 色は「事業・直接・再委託・別財源」の意味付けのみに使う。
 *   「移替」「参考」などはグレー系に落とし、意味色を増やさない。
 *
 * 配色の根拠（dataviz validator, --mode light, categorical 4色）:
 *   #4db870,#d94545,#d9952b,#7b5ea7 → ALL CHECKS PASS
 *   旧・再委託 #e07040 は直接 #d94545 と分離不足
 *   （通常視覚 ΔE 9.0=FAIL / CVD ΔE 6.8）だったため #d9952b に変更。
 *   別財源は旧 #6366f1（インディゴ）がリンク青と衝突するため紫 #7b5ea7 に変更。
 *   色単独判別に依存させず、必ずタグ文字（直接/再委託/別財源）を併記すること。
 */

/** 事業・予算側（緑）。メインSankeyの project-budget と同一 */
export const SEMANTIC_PROJECT = '#4db870';
/** 事業・予算側の濃色（総計・省庁・見出し用） */
export const SEMANTIC_PROJECT_DEEP = '#3a9a5c';
/**
 * 事業側の濃緑ソリッド。白文字を載せる面（「事業」タグ・総計ノード）用で、
 * 白文字とのコントラストが WCAG 4.5:1 を満たす（#3a9a5c は満たさないので白文字面には使わない）。
 */
export const SEMANTIC_PROJECT_SOLID = '#2d7d46';
/** 直接支出（赤）。メインSankeyの recipient と同一 */
export const SEMANTIC_DIRECT = '#d94545';
/** 再委託（アンバー） */
export const SEMANTIC_SUBCONTRACT = '#d9952b';
/** 別財源（紫）。財投借入・自己収入・利水者負担等 */
export const SEMANTIC_SEPARATE_ORIGIN = '#7b5ea7';
