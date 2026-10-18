/**
 * AI ナビの「〜に移動して」で行けるページ。ツール navigate_page の選択肢と、クライアントの遷移先。
 * components/navigation/pages.ts と同じ href を使う（app/lib は components を import しないので、ここに別表を持つ。
 * 整合は tests/nav-targets.test.ts で確認する）。純粋なデータ。
 */
export interface NavTarget {
  /** ツールに渡すキー */
  key: string;
  href: string;
  label: string;
  /** ユーザーの言い方（プロンプトの説明に使う） */
  aliases: string[];
}

export const NAV_TARGETS: readonly NavTarget[] = [
  { key: 'sankey', href: '/budget-sankey', label: 'サンキー図', aliases: ['サンキー', '流れの図'] },
  { key: 'bubble', href: '/project-bubble', label: 'バブル図', aliases: ['バブルチャート', '散布図'] },
  { key: 'quality', href: '/quality', label: '評価一覧', aliases: ['AI 評価', 'スコア一覧', '評価'] },
  { key: 'subcontracts', href: '/subcontracts', label: '委託構造', aliases: ['再委託', '委託'] },
  { key: 'vendors', href: '/vendors', label: '事業者', aliases: ['事業者別', '受注企業'] },
  { key: 'funds', href: '/funds', label: '基金', aliases: [] },
  { key: 'budget-requests', href: '/budget-requests', label: '概算要求', aliases: ['要求'] },
  { key: 'tax-expenditures', href: '/tax-expenditures', label: '租税特別措置', aliases: ['税優遇', '租特'] },
  { key: 'tax-burden', href: '/tax-burden', label: '国民負担', aliases: ['歳入', '税負担'] },
  { key: 'fiscal-space', href: '/fiscal-space', label: '財政余力', aliases: ['シミュレータ'] },
  { key: 'home', href: '/', label: 'トップ', aliases: ['ホーム', '最初のページ'] },
];

export const NAV_TARGET_KEYS = NAV_TARGETS.map(t => t.key);
export const findNavTarget = (key: unknown): NavTarget | null =>
  (typeof key === 'string' ? NAV_TARGETS.find(t => t.key === key) ?? null : null);
