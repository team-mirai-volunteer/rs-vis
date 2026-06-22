/**
 * 支出先名検索（Pure関数）。
 * 逆引きインデックスの名称・表記ゆれ（aliases）に対する正規化部分一致。
 */
import type { RecipientEntry } from '@/types/recipient-index';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

export interface RecipientSearchResult {
  totalHits: number;
  items: RecipientEntry[];
}

export function searchRecipients(
  recipients: Record<string, RecipientEntry>,
  query: string,
  limit: number,
): RecipientSearchResult {
  const q = normalizeRecipientName(query);
  if (!q) return { totalHits: 0, items: [] };

  const hits: RecipientEntry[] = [];
  for (const entry of Object.values(recipients)) {
    if (entry.aliases.some(a => normalizeRecipientName(a).includes(q))) {
      hits.push(entry);
    }
  }

  // 受注規模順（直接・再委託は別軸のため、並び替え専用にのみ最大値を使う）
  hits.sort(
    (a, b) =>
      Math.max(b.totals.directAmount, b.totals.subcontractAmount) -
      Math.max(a.totals.directAmount, a.totals.subcontractAmount),
  );

  return { totalHits: hits.length, items: hits.slice(0, limit) };
}
