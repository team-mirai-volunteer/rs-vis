/**
 * 事項別内訳の絞り込み（純粋関数）。
 *
 * /sankey-svg の buildFilterExcludedIds は事業/支出先ノードを除外集合として
 * 作り、後段の描画側でそれを見て除く。mof-hierarchy は毎リクエストで
 * MOFJikouItem[] から階層を組み直す作りなので、同じことは「階層を組む前に
 * 事項をふるい落とす」だけで済む。除外集合を持ち回る必要が無く、
 * 該当が無くなった所管・組織は元から現れない（buildFullNodeMap が
 * 生き残った事項だけから木を作るため）。
 */

import type { MOFJikouItem } from '@/types/mof-jikou';
import type { MOFHierarchyFilter, MOFHierarchyNameFilter } from '@/types/mof-hierarchy';
import { ACCOUNT_LABELS, levelsOf } from './mof-hierarchy-sankey';

/** 何か1つでも条件が指定されているか。空配列・空文字・null は「条件無し」に数える */
export function hasActiveMOFHierarchyFilter(filter: MOFHierarchyFilter): boolean {
  return (
    (filter.ministries?.length ?? 0) > 0 ||
    (filter.accountTypes?.length ?? 0) > 0 ||
    !!filter.sectionName?.query.trim() ||
    !!filter.itemName?.query.trim() ||
    filter.minAmount != null ||
    filter.maxAmount != null
  );
}

/**
 * 名前の照合関数を作る。不正な正規表現は「何も除外しない」側に倒す
 * （/sankey-svg の buildMatcher と同じ思想。フィルタの不備で図が
 * 全滅するより、効かないだけの方が実害が小さい）。
 */
function buildMatcher(filter: MOFHierarchyNameFilter | undefined): ((name: string) => boolean) | null {
  const query = filter?.query.trim();
  if (!query) return null;
  if (filter?.regex) {
    try {
      const re = new RegExp(query, 'i');
      return name => re.test(name);
    } catch {
      return () => true;
    }
  }
  const q = query.toLocaleLowerCase();
  return name => name.toLocaleLowerCase().includes(q);
}

/** 所管名の解決。政府関係機関は所管が空なので levelsOf と同じ規則（機関名）に揃える */
function ministryLabelOf(item: MOFJikouItem): string {
  return levelsOf(item).ministry;
}

export function filterMOFJikouItems(
  items: MOFJikouItem[],
  filter: MOFHierarchyFilter
): MOFJikouItem[] {
  if (!hasActiveMOFHierarchyFilter(filter)) return items;

  const ministrySet = filter.ministries?.length ? new Set(filter.ministries) : null;
  const accountSet = filter.accountTypes?.length ? new Set(filter.accountTypes) : null;
  const matchesSection = buildMatcher(filter.sectionName);
  const matchesItem = buildMatcher(filter.itemName);
  const min = filter.minAmount ?? -Infinity;
  const max = filter.maxAmount ?? Infinity;

  return items.filter(item => {
    if (ministrySet && !ministrySet.has(ministryLabelOf(item))) return false;
    if (accountSet && !accountSet.has(item.accountType)) return false;
    if (matchesSection && !matchesSection(item.sectionName)) return false;
    if (matchesItem && !matchesItem(item.name)) return false;
    if (item.amount < min || item.amount > max) return false;
    return true;
  });
}

export { ACCOUNT_LABELS };
