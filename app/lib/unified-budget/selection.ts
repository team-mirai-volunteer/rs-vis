/** Keep the same project when the destination year has budgets but no spending column. */
export function resolveSelection(selectedId: string | null, nodes: readonly { id: string }[]): string | null {
  if (!selectedId) return null;
  if (nodes.some(node => node.id === selectedId)) return selectedId;
  if (selectedId.startsWith('project-spending-')) {
    const budgetId = selectedId.replace('project-spending-', 'project-budget-');
    if (nodes.some(node => node.id === budgetId)) return budgetId;
  }
  return null;
}
