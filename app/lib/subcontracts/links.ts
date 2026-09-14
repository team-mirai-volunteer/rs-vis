import { unifiedProjectUrl } from '@/app/lib/unified-budget/links';

export function rsSystemProjectSearchUrl(projectName: string, year: number): string {
  const query = projectName.replace(/\//g, '');
  return `https://rssystem.go.jp/project?q=${encodeURIComponent(query)}&fiscalYear=${year}&isSearchTargetProjectName=true`;
}

/**
 * 統合ビュー（/budget-sankey）で対象事業を選択し、関連ノードだけを表示した状態で開く URL。
 * かつては /sankey-svg を指していた（関数名は互換のため残す）。year は RS シート年度。
 * 表示位置は統合ビュー側が選択ノードに合わせて自動で動かすので指定しない。
 */
export function sankeySvgProjectUrl(projectId: number, _projectName: string, year: number): string {
  return unifiedProjectUrl(projectId, year);
}
