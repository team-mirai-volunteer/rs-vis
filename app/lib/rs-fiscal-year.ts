/** UI は実績年度、既存 API と旧 URL の year/yr はレビューシート年度。 */
export function fiscalYear(sheetYear: string | number): number {
  return Number(sheetYear) === 2026 ? 2026 : Number(sheetYear) - 1;
}

export function sheetYearFromParams(params: Pick<URLSearchParams, 'get'>, legacyKey = 'year', allowRequest = false): string {
  const fiscal = params.get('fiscalYear');
  if (fiscal === '2023' || fiscal === '2024') return String(Number(fiscal) + 1);
  if (allowRequest && fiscal === '2026') return '2026';
  const legacy = params.get(legacyKey);
  return legacy === '2024' || legacy === '2025' || (allowRequest && legacy === '2026') ? legacy : '2025';
}

export function fiscalYearLabel(sheetYear: string | number): string {
  return `${fiscalYear(sheetYear)}年度${Number(sheetYear) === 2026 ? '（要求）' : ''}`;
}

export function rsViewUrl(path: string, sheetYear: string | number): string {
  return `${path}${path.includes('?') ? '&' : '?'}fiscalYear=${fiscalYear(sheetYear)}`;
}

/** 対応年度があるビューへ移るときは、選択中の実績年度を保つ。 */
export function fiscalNavigationUrl(path: string, year?: number): string {
  if (year === undefined) return path;
  if (path === '/budget-sankey') return `${path}?year=${year}`;
  if (['/quality', '/subcontracts', '/project-bubble'].includes(path)
    && (year === 2023 || year === 2024 || (path === '/quality' && year === 2026))) return `${path}?fiscalYear=${year}`;
  return path;
}
