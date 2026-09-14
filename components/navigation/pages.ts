/**
 * 公開ページの一覧。AppHeader（主要ナビ）と PageNavMenu（全件メニュー）とトップページのカードが共有する。
 * 追加するときはここに 1 行足すだけでナビ・メニュー・トップページの 3 箇所に反映される。
 */
export const PAGES = [
  { href: '/fiscal-space', label: '財政余力シミュレータ', description: '次の1兆円で何が最初に足りなくなるか。政策・物価・労働・エネルギー・国債借換を仮定モデルで比較する', primary: true },
  { href: '/budget-sankey', label: 'サンキー図', description: '財務省予算書（会計・所管・項・目）から RS 事業・支出先までの流れを 1 本のサンキーで追う。「RSのみ」で省庁 → 事業 → 支出先だけにも絞れる', primary: true },
  { href: '/project-bubble', label: 'バブルチャート', description: '5,000 超の事業を内容の近さで配置し、評価の低い事業を大きく表示する', primary: true },
  { href: '/quality', label: '評価一覧', description: '事業ごとの政策評価・執行透明性スコアを一覧で見る', primary: true },
  { href: '/subcontracts', label: '委託構造', description: '事業ごとの支出先・再委託先の構造を図と表で確かめる', primary: true },
  { href: '/tax-burden', label: '歳入・国民負担（試作）', description: '年収・家族構成別の税と保険料の負担率、国の税目別歳入を見る', primary: true },
  { href: '/mof-budget-overview', label: '予算全体（MOF）', description: '一般会計・特別会計の歳入から歳出までの全体フロー', primary: false },
  { href: '/mof-jikou', label: '予算書 事項（MOF）', description: '財務省予算書の「事項」を一覧・絞り込み', primary: false },
  { href: '/mof-kou-moku', label: '予算書 科目別内訳（MOF）', description: '「項・目」の内訳を一覧・絞り込み', primary: false },
  { href: '/mof-kou', label: '予算書 項一覧（MOF）', description: '「項」ごとの予算額と RS 事業との紐づきを一覧', primary: false },
  { href: '/mof-hierarchy', label: '予算書 階層フロー（MOF）', description: '所管 → 組織 → 項 → 事項の階層をサンキーで追う', primary: false },
  { href: '/mof-sankey', label: '予算書 項×RS事業（MOF）', description: '予算書の「項」と RS 事業の対応をサンキーで見る', primary: false },
] as const;

export type NavPageHref = (typeof PAGES)[number]['href'];

/** ヘッダーの主要ナビに出すページ（残りは PageNavMenu の全件メニューへ） */
export const PRIMARY_PAGES = PAGES.filter(p => p.primary);

/** ヘッダー・トップページで使う製品名 */
export const PRODUCT_NAME = '行政事業レビュー可視化';
