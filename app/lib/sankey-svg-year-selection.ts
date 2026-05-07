import type { GraphData, RawNode } from '@/types/sankey-svg';

export type YearSelectionSnapshot = {
  type: RawNode['type'];
  name: string;
  projectId?: number;
};

export function resolveYearSelectionSnapshot(snapshot: YearSelectionSnapshot, graphData: GraphData): string | null {
  if ((snapshot.type === 'project-budget' || snapshot.type === 'project-spending') && snapshot.projectId != null) {
    return `project-spending-${snapshot.projectId}`;
  }

  if (snapshot.type === 'recipient') {
    const recipient = graphData.nodes
      .filter(n => n.type === 'recipient' && n.name === snapshot.name)
      .sort((a, b) => b.value - a.value)[0];
    return recipient?.id ?? null;
  }

  const node = graphData.nodes.find(n => n.type === snapshot.type && n.name === snapshot.name);
  return node?.id ?? null;
}
