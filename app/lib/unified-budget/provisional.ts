import { UNIFIED_COLUMNS, type UnifiedGraph, type UnifiedNode } from '@/types/unified-budget';

/** Keep the selected MOF budget basis; attach only the provisional RS spending side. */
export function withProvisionalSpending(budget: UnifiedGraph, execution: UnifiedGraph): UnifiedGraph {
  if (budget.metadata.budgetYear !== execution.metadata.budgetYear || !execution.metadata.apiCoverage) {
    throw new Error('暫定支出と予算の年度が一致しません');
  }
  const apiPrograms = new Map(execution.nodes.filter(n => n.col === 'program').map(n => [n.projectId, n]));
  const nodes: UnifiedNode[] = budget.nodes.filter(n => n.col !== 'program-spending' && n.col !== 'recipient').map(n =>
    n.col === 'program' && n.kind === 'rs' && apiPrograms.has(n.projectId)
      ? { ...n, sourceUrl: apiPrograms.get(n.projectId)!.sourceUrl } : { ...n });
  const ids = new Set(nodes.map(n => n.id));
  const edges = budget.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e }));
  let unmatched = 0;
  const spending = execution.nodes.filter(n => n.col === 'program-spending');
  for (const n of spending) {
    const id = `project-budget-${n.projectId}`;
    if (!ids.has(id)) {
      // A layout placeholder is explicitly unknown, not a 0-yen budget fact. No MOF edge is invented.
      const source = apiPrograms.get(n.projectId)!;
      nodes.push({ ...source, id, value: 0, budgetUnmatched: true });
      ids.add(id);
      unmatched++;
    }
    edges.push({ source: id, target: n.id, value: n.value });
  }
  nodes.push(...execution.nodes.filter(n => n.col === 'program-spending' || n.col === 'recipient'));
  const spendingIds = new Set(spending.map(n => n.id));
  edges.push(...execution.edges.filter(e => spendingIds.has(e.source)));
  const counts = { ...budget.metadata.counts };
  for (const column of UNIFIED_COLUMNS) counts[column] = nodes.filter(n => n.col === column).length;
  counts.edges = edges.length;
  return { nodes, edges, metadata: { ...budget.metadata, hasSpending: true, rsSheetYear: execution.metadata.rsSheetYear,
    apiCoverage: { ...execution.metadata.apiCoverage, unmatchedBudgetProjects: unmatched }, counts,
    notes: [...budget.metadata.notes, '左側の予算額・MOF接続は選択した予算基準を保持。右側は2026年度RSシートの2025年度支出先を予算事業IDで接続。',
      `予算事業と未突合の${unmatched}件は予算額不明と表示し、MOFからの接続を作らない。`] } };
}
