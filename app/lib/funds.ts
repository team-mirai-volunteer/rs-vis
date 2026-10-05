/**
 * 基金の論点の判定と表示ラベル（Pure 層）。データは scripts/generate-funds.ts が作る public/data/funds.json。
 * 残高が大きいこと自体は問題ではない（複数年度の事業費を先に積む制度）。新規受付の終了後や終了予定日の後の残高、
 * 支出に比べて過大な残高、国庫返納、府省自身の低執行点検の該当を「確かめる手がかり」として拾う。
 */
import type { Fund, FundYear } from '@/types/funds';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

export type FundSignal = 'newApplicationClosed' | 'pastEnd' | 'tenYears' | 'noSpending' | 'returned' | 'ownershipOverOne' | 'inspection';

export const FUND_SIGNAL_LABELS: Record<FundSignal, string> = {
  newApplicationClosed: '新規受付の終了後も残高',
  pastEnd: '終了予定日の後も残高',
  tenYears: '残高が支出の10年分以上',
  noSpending: '残高はあるが支出ゼロ',
  returned: '国庫返納あり',
  ownershipOverOne: '保有割合が1超',
  inspection: '低執行の点検に該当',
};

export const FUND_SIGNAL_DESCRIPTIONS: Record<FundSignal, string> = {
  newApplicationClosed: '新しい申請の受付を終えた時点（基金シートの新規受付終了日）を過ぎているのに、年度初めの残高がある基金。',
  pastEnd: '基金シートの終了予定日を過ぎているのに、年度初めの残高がある基金。',
  tenYears: '年度初めの残高が、前年度の支出の10年分以上ある基金。造成したばかりで支出が立ち上がっていない基金も含まれる。',
  noSpending: '年度初めの残高があるのに、前年度の支出がゼロか記載がない基金。',
  returned: '前年度に国庫へ返納した額がある基金（使わない分を国に返したもの）。',
  ownershipOverOne: '保有割合（基金残高 ÷ 今後の事業に必要な額）が1を超える基金。必要額より多く持っている。',
  inspection: '基金シートの「低執行の基金の点検」で、実績が無い・事業を終えた・目的を失った・保有割合が1を大きく超える・使われる見込みが無い、のいずれかに該当すると府省が記載した基金。',
};

export const FUND_SIGNALS = Object.keys(FUND_SIGNAL_LABELS) as FundSignal[];

/** 最新のシート年度の値 */
export const latestYear = (f: Fund): FundYear => f.years[f.years.length - 1];

/** 年度初めの残高が前年度の支出の何年分か。支出が無ければ null */
export function spendingYears(y: FundYear): number | null {
  return y.balance !== null && y.balance > 0 && y.expense !== null && y.expense > 0 ? y.balance / y.expense : null;
}

/** 最新のシート年度で当てはまる論点。日付の判定は、残高の時点（シート年度の4月1日）で行う */
export function fundSignals(f: Fund): FundSignal[] {
  const y = latestYear(f);
  const asOf = `${y.sheetYear}-04-01`;
  const hasBalance = (y.balance ?? 0) > 0;
  const out: FundSignal[] = [];
  if (hasBalance && f.newApplicationEndDate && f.newApplicationEndDate < asOf) out.push('newApplicationClosed');
  if (hasBalance && f.endDate && f.endDate < asOf) out.push('pastEnd');
  const years = spendingYears(y);
  if (years !== null && years >= 10) out.push('tenYears');
  if (hasBalance && !(y.expense !== null && y.expense > 0)) out.push('noSpending');
  if ((y.returned ?? 0) > 0) out.push('returned');
  if (y.ownership !== null && y.ownership > 1) out.push('ownershipOverOne');
  if (Object.values(f.inspection).some(Boolean)) out.push('inspection');
  return out;
}

export const INSPECTION_LABELS: Record<keyof Fund['inspection'], string> = {
  noRecentResult: '直近の実績が無い',
  ceasedOperations: '事業を終えている',
  lostPurpose: '目的を失っている',
  ownershipFarAboveOne: '保有割合が1を大きく超える',
  unlikelyToBeUsed: '使われる見込みが無い',
};

/** 保有法人の名前で基金を引く（支出先の説明から「この法人が持つ基金」を出す） */
export function fundsHeldBy(funds: readonly Fund[], names: readonly string[]): Fund[] {
  const keys = new Set(names.map(normalizeRecipientName).filter(Boolean));
  return funds.filter(f => f.owner && keys.has(normalizeRecipientName(f.owner)));
}

/** 造成元・関連の事業（予算事業ID）から基金を引く */
export const fundsOfProject = (funds: readonly Fund[], pid: string) => funds.filter(f => f.relatedPids.includes(pid));

export const BUDGET_LABELS: Record<string, string> = { initial: '当初', supplementary1: '補正（第1号）', supplementary2: '補正（第2号）', supplementary3: '補正（第3号）', reserve: '予備費' };
export const budgetLabel = (b: string | null) => (b ? BUDGET_LABELS[b] ?? b : '—');

/** 表の論点バッジ用の短い表記 */
export const FUND_SIGNAL_SHORT: Record<FundSignal, string> = {
  newApplicationClosed: '受付終了後', pastEnd: '終了予定後', tenYears: '10年分超', noSpending: '支出ゼロ',
  returned: '国庫返納', ownershipOverOne: '保有>1', inspection: '点検該当',
};

/** 基金の運営の形態（基金シートの区分） */
export const OPERATION_FORM_LABELS: Record<string, string> = {
  reduce: '取崩し型', turnover: '回転型', operation: '運用型', possession: '保有型', others: 'その他',
};
/** 基金で行う事業の形態 */
export const BUSINESS_FORM_LABELS: Record<string, string> = {
  subsidy: '補助', loan: '貸付', compensation: '補填・補償', investigation: '調査研究', 'interest-subsidy': '利子補給',
  investment: '出資', 'debt-guarantee': '債務保証', others: 'その他',
};
/** 保有法人の法人格 */
export const OWNER_FORM_LABELS: Record<string, string> = {
  'national-research-and-development-agency': '国立研究開発法人', 'independent-administrative-agency': '独立行政法人',
  'general-incorporated-association': '一般社団法人', 'general-incorporated-foundation': '一般財団法人',
  'public-interest-incorporated-association': '公益社団法人', 'public-interest-incorporated-foundation': '公益財団法人',
  'corporation-established-by-special-law': '特殊法人', 'private-corporation-established-by-special-law': '特別民間法人',
  'authorized-corporation': '認可法人', 'specified-nonprofit-corporation': '特定非営利活動法人', others: 'その他',
};
export const formLabels = (codes: readonly string[], labels: Record<string, string>) => codes.map(c => labels[c] ?? c);
