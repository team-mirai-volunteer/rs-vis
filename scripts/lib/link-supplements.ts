/**
 * レビューシート 2-2 の項・目が空欄の行を、予算書の目に結びつける手がかり（補完リンク）。
 * generate-mof-rs-kou-moku-linkage.ts（結びつけの生成）と suggest-mof-rs-link-supplements.ts（候補の表示）で共用。
 */
import type { MOFKouMokuItem } from '../../types/mof-kou-moku';

export const normName = (s: string) => s.normalize('NFKC').replace(/[\s／/]/g, '');
const core = (s: string) => normName(s).replace(/(に必要な経費|等?事業費?補助金|補助金|交付金|負担金|委託費|事業費|経費|費)+$/, '');

/** レビューシートの府省（外局を含む）→ 予算書の所管に含まれる名前 */
const MINISTRY_OF: Record<string, string> = {
  こども家庭庁: '内閣府', 消費者庁: '内閣府', 警察庁: '内閣府', 個人情報保護委員会: '内閣府', 金融庁: '内閣府', 公正取引委員会: '内閣府',
  林野庁: '農林水産省', 水産庁: '農林水産省', 中小企業庁: '経済産業省', 資源エネルギー庁: '経済産業省', 特許庁: '経済産業省',
  文化庁: '文部科学省', スポーツ庁: '文部科学省', 国税庁: '財務省', 観光庁: '国土交通省', 気象庁: '国土交通省', 海上保安庁: '国土交通省',
  消防庁: '総務省', 出入国在留管理庁: '法務省', 公安調査庁: '法務省', 防衛装備庁: '防衛省', 原子力規制委員会: '環境省',
};

export interface SupplementRow {
  projectName: string;
  projectMinistry: string;
  /** '一般会計' | '特別会計' */
  accountCategory: string;
  /** 特別会計の会計名・勘定（空欄可） */
  account: string;
  subAccount: string;
  note: string;
  amount: number;
}

/** 同じ予算種別・会計区分・府省（特別会計は会計名・勘定も）の目に絞る */
export function sameScope(row: SupplementRow, items: MOFKouMokuItem[], budgetType: string): MOFKouMokuItem[] {
  const accountType = row.accountCategory === '一般会計' ? 'general' : 'special';
  const ministry = row.projectMinistry.replace(/\s.*$/, '');
  return items.filter(m => m.budgetType === budgetType && m.accountType === accountType && m.amount > 0
    && (m.ministry.includes(ministry) || m.ministry.includes(MINISTRY_OF[ministry] ?? '\u0000') || m.organization === ministry)
    && (accountType === 'general' || !row.account || normName(m.specialAccount) === normName(row.account))
    && (accountType === 'general' || !row.subAccount || !m.subAccount || normName(m.subAccount) === normName(row.subAccount)));
}

/** その行の補足情報に、項名と目名の両方が書かれている目 */
export function byNote(row: SupplementRow, scope: MOFKouMokuItem[]): MOFKouMokuItem[] {
  const note = normName(row.note ?? '');
  if (!note) return [];
  return scope.filter(m => note.includes(normName(m.subItemName)) && note.includes(normName(m.sectionName)));
}

export const amountHit = (amount: number, m: MOFKouMokuItem) => Math.abs(m.amount - amount) <= Math.max(1e6, m.amount * .001);
export const nameHit = (projectName: string, m: MOFKouMokuItem) => {
  const c = core(m.subItemName);
  return c.length >= 4 && (normName(projectName).includes(c) || normName(m.subItemName).includes(core(projectName)));
};
