export function rsSystemProjectSearchUrl(projectName: string, year: number): string {
  const query = projectName.replace(/\//g, '');
  return `https://rssystem.go.jp/project?q=${encodeURIComponent(query)}&fiscalYear=${year}&isSearchTargetProjectName=true`;
}

/**
 * /sankey-svg で対象事業を選択・ピンした状態を開くURL。
 *
 * 表示件数（tp/tr）は既定のまま渡さない。ピン事業は TopN 圏外でも必ず描画されるうえ、
 * 上限300を指定すると「関連ノードのみ」を解除した瞬間に300事業・300支出先が出て視認性が落ちるため。
 * 事業列のスクロール位置（po）も指定しない — 順位はグラフ読込後でないと決まらないので、
 * /sankey-svg 側が pp から順位を引いて中央寄せする。
 */
export function sankeySvgProjectUrl(projectId: number, projectName: string, year: number): string {
  const budgetNodeId = `project-budget-${projectId}`;
  const spendingNodeId = `project-spending-${projectId}`;
  const params = new URLSearchParams({
    yr: String(year),
    sel: budgetNodeId,
    pp: spendingNodeId,
    fr: '1',
    q: projectName,
  });
  return `/sankey-svg?${params.toString()}`;
}
