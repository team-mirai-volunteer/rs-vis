export function canonicalSelectableNodeId(id: string | null): string | null {
  if (id === null) return null;
  if (id.startsWith('project-spending-')) return id.replace('project-spending-', 'project-budget-');
  if (id === '__agg-project-spending') return '__agg-project-budget';
  return id;
}
