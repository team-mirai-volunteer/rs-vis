/**
 * 予算→項→RS紐づけサンキーの絞り込み（純粋関数）。
 *
 * `mof-hierarchy-filter.ts` と同じ考え方（階層を組む前に項をふるい落とす）。
 * 入力は `mof-section-rs-sankey.ts` の `MOFSectionRsSourceRow`（`mof-kou-loader.ts` の
 * `MOFKouSectionSummary` をそのまま渡せる形）。
 */

import type { MOFAccountType } from '@/types/mof-jikou';
import type { MOFSectionRsFilter, MOFSectionRsNameFilter } from '@/types/mof-section-rs-sankey';
import { ACCOUNT_LABELS } from './mof-hierarchy-sankey';
import type { MOFSectionRsSourceRow } from './mof-section-rs-sankey';

export function hasActiveMOFSectionRsFilter(filter: MOFSectionRsFilter): boolean {
  return (
    (filter.ministries?.length ?? 0) > 0 ||
    (filter.accountTypes?.length ?? 0) > 0 ||
    !!filter.sectionName?.query.trim() ||
    filter.minAmount != null ||
    filter.maxAmount != null
  );
}

function buildMatcher(filter: MOFSectionRsNameFilter | undefined): ((name: string) => boolean) | null {
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

function ministryLabelOf(row: MOFSectionRsSourceRow): string {
  return row.ministry || ACCOUNT_LABELS[row.accountType];
}

export function filterMOFSectionRsRows(
  rows: MOFSectionRsSourceRow[],
  filter: MOFSectionRsFilter
): MOFSectionRsSourceRow[] {
  if (!hasActiveMOFSectionRsFilter(filter)) return rows;

  const ministrySet = filter.ministries?.length ? new Set(filter.ministries) : null;
  const accountSet = filter.accountTypes?.length ? new Set(filter.accountTypes) : null;
  const matchesSection = buildMatcher(filter.sectionName);
  const min = filter.minAmount ?? -Infinity;
  const max = filter.maxAmount ?? Infinity;

  return rows.filter(row => {
    if (ministrySet && !ministrySet.has(ministryLabelOf(row))) return false;
    if (accountSet && !accountSet.has(row.accountType as MOFAccountType)) return false;
    if (matchesSection && !matchesSection(row.sectionName)) return false;
    if (row.amount < min || row.amount > max) return false;
    return true;
  });
}
