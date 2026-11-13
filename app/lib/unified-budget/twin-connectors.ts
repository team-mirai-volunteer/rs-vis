import type { UnifiedViewDetails } from '@/types/unified-budget-view';

/**
 * 事業（program）と事業(支出)（program-spending）は同じ事業の双子。
 * 金額の帯（min(予算額, 支出額)）が引けない組は、金額を持たない点線で「同じ事業」だとつなぐ。
 * - no-budget: 予算額の記載が無い（一括計上など）が支出はある
 * - no-spending: 予算はあるが支出先への支出の記載が無い
 * - both-empty: どちらも記載が無い
 */
export type TwinConnectorReason = 'no-budget' | 'no-spending' | 'both-empty';

export interface TwinConnector<N> {
  program: N;
  spending: N;
  reason: TwinConnectorReason;
}

interface NodeLike {
  id: string;
  value: number;
  details?: UnifiedViewDetails;
}

const twinKey = (d: UnifiedViewDetails | undefined): string | null => {
  if (!d) return null;
  if (d.aggregated) return 'aggregated';
  if (d.projectId === undefined || (d.kind && d.kind !== 'rs')) return null;
  return `pid:${d.projectId}`;
};

export function twinConnectors<N extends NodeLike>(
  nodes: readonly N[],
  links: readonly { source: { id: string }; target: { id: string } }[],
): TwinConnector<N>[] {
  const programs = new Map<string, N>();
  for (const n of nodes) {
    if (n.details?.column !== 'program') continue;
    const key = twinKey(n.details);
    if (key) programs.set(key, n);
  }
  const linked = new Set(links.map(l => `${l.source.id}\u0000${l.target.id}`));
  const out: TwinConnector<N>[] = [];
  for (const spending of nodes) {
    if (spending.details?.column !== 'program-spending') continue;
    const key = twinKey(spending.details);
    const program = key ? programs.get(key) : undefined;
    if (!program || linked.has(`${program.id}\u0000${spending.id}`)) continue;
    const hasBudget = program.value > 0;
    const hasSpending = spending.value > 0;
    // 両方あるのに帯が無い組は生成側の想定外。点線で隠さない
    if (hasBudget && hasSpending) continue;
    out.push({ program, spending, reason: hasSpending ? 'no-budget' : hasBudget ? 'no-spending' : 'both-empty' });
  }
  return out;
}

/** 点線（送り手の右端中央 → 受け手の左端中央）の SVG パス */
export function twinConnectorPath(
  program: { x: number; y: number; width: number; height: number },
  spending: { x: number; y: number; height: number },
): string {
  const x0 = program.x + program.width;
  const y0 = program.y + program.height / 2;
  const x1 = spending.x;
  const y1 = spending.y + spending.height / 2;
  const mx = (x0 + x1) / 2;
  return `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
}
