/** sankey-svg と同じ会計区分ラベル表記 */
export function accountCategoryLabel(category: string): string {
  if (category === '一般会計+特別会計') return '一般・特別';
  if (category === '一般会計') return '一般会計';
  if (category === '特別会計') return '特別会計';
  return category;
}

/** 担当組織の末端要素を取り出す */
export function bureauLeaf(bureau: string): string {
  if (!bureau) return '';
  const parts = bureau.split(' / ');
  return parts[parts.length - 1] ?? '';
}
