export function rsSystemProjectSearchUrl(projectName: string, year: number): string {
  const query = projectName.replace(/\//g, '');
  return `https://rssystem.go.jp/project?q=${encodeURIComponent(query)}&fiscalYear=${year}&isSearchTargetProjectName=true`;
}

export function sankeySvgProjectUrl(projectId: number, projectName: string, year: number): string {
  const budgetNodeId = `project-budget-${projectId}`;
  const spendingNodeId = `project-spending-${projectId}`;
  const params = new URLSearchParams({
    yr: String(year),
    sel: budgetNodeId,
    pp: spendingNodeId,
    fr: '1',
    q: projectName,
    tp: '300',
    tr: '300',
  });
  return `/sankey-svg?${params.toString()}`;
}
