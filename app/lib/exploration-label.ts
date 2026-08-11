/**
 * 探索履歴・発見メモの自動ラベル合成（Pure）。
 *
 * SankeyQuery のフィルタ次元から「2024・経済産業省・事業名"半導体"・予算100億円以上」の
 * 形式の短い日本語ラベルを作る。履歴ドロップダウン（ExplorationHistory）で使う。
 * 件数は含めない（TopN 適用後の表示件数しか安価に取れず、誤解を招くため）。
 */
import type { SankeyQuery, SankeyAmountRange, AccountCategoryKey } from '@/types/sankey-query';
import { formatYen } from '@/app/lib/sankey-svg-constants';

/** 府省庁リストの表示上限（超過分は「他N」に畳む） */
const MINISTRY_DISPLAY_MAX = 2;

const ACCOUNT_LABELS: Record<AccountCategoryKey, string> = {
  general: '一般会計',
  special: '特別会計',
  both: '一般+特別',
  none: '区分なし',
};

/** 金額範囲を「100億円以上」「〜1兆円」「100億〜1兆円」の形式に。範囲指定なしは null */
function rangeLabel(prefix: string, range: SankeyAmountRange | undefined): string | null {
  const min = range?.min ?? null;
  const max = range?.max ?? null;
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${prefix}${formatYen(min)}〜${formatYen(max)}`;
  if (min !== null) return `${prefix}${formatYen(min)}以上`;
  return `${prefix}${formatYen(max!)}以下`;
}

/** 名前フィルタを「事業名"半導体"」の形式に（regex はそのまま見せる） */
function nameLabel(prefix: string, filter: { query: string } | undefined): string | null {
  const q = filter?.query?.trim();
  if (!q) return null;
  return `${prefix}"${q}"`;
}

/**
 * クエリからラベルを合成する。フィルタが何もなければ「フィルタなし」。
 * 例: 「2024・経済産業省/環境省 他1・事業名"半導体"・予算100億円以上」
 */
export function buildExplorationLabel(query: SankeyQuery): string {
  const parts: string[] = [];
  if (query.year) parts.push(query.year);

  const ministries = query.filter?.ministries ?? [];
  if (ministries.length > 0) {
    const shown = ministries.slice(0, MINISTRY_DISPLAY_MAX).join('/');
    const rest = ministries.length - MINISTRY_DISPLAY_MAX;
    parts.push(rest > 0 ? `${shown} 他${rest}` : shown);
  }

  const projectName = nameLabel('事業名', query.filter?.projectName);
  if (projectName) parts.push(projectName);
  const recipientName = nameLabel(
    query.filter?.recipientName?.includeSubcontract ? '支出先/再委託先' : '支出先',
    query.filter?.recipientName,
  );
  if (recipientName) parts.push(recipientName);

  const budget = rangeLabel('予算', query.filter?.budget);
  if (budget) parts.push(budget);
  const spending = rangeLabel('受領額', query.filter?.spending);
  if (spending) parts.push(spending);

  const accounts = query.filter?.accountCategories;
  if (accounts && accounts.length > 0 && accounts.length < 4) {
    parts.push(accounts.map(a => ACCOUNT_LABELS[a]).join('/'));
  }

  const sub = query.filter?.subcontract;
  if (sub?.minDepth != null && sub.minDepth >= 2) parts.push(`再委託階層${sub.minDepth}以上`);
  else if (sub?.hasRedelegation) parts.push('再委託あり');


  const hasFilter = parts.length > (query.year ? 1 : 0);
  if (!hasFilter) parts.push('フィルタなし');
  return parts.join('・');
}
