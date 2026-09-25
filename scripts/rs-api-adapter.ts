import type { RsApiDetail, RsApiEdge, RsApiGroup, RsApiProject } from '../types/rs-api';
import type { UnifiedEdge, UnifiedNode } from '../types/unified-budget';
import { buildRecipientKey } from '../app/lib/recipient-key';

export function knownAmount(value: number | null | undefined, hidden = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && !hidden ? value : null;
}

export function apiDetail(project: RsApiProject, groups?: RsApiGroup[], edges?: RsApiEdge[], fetchedAt: string | null = null): RsApiDetail {
  const fiscalYear = project.fiscal_year - 1;
  // In RS sheets, payments describe the previous fiscal year (R08作成要領).
  // last_implemented_fiscal_year is the last EXTERNAL REVIEW, not a payment year.
  return {
    id: project.id, projectId: Number(project.project_number), name: project.name, ministry: project.ministry_name,
    sourceUrl: `https://rssystem.go.jp/project/${project.id}?statsType=table&activeKey=payment`, fiscalYear,
    overview: project.overview, purpose: project.purpose,
    execution: knownAmount(project.previous_year_execution_amount, project.negative_previous_year_execution_amount_count),
    paymentStatus: groups && edges ? 'available' : 'missing',
    fetchedAt, groups: groups && edges ? groups : [], edges: groups && edges ? edges : [],
  };
}

/** Only explicit root edges count as direct spending. Never promote orphan/indirect blocks. */
export function directPayments(detail: RsApiDetail) {
  const direct = new Set(detail.edges.filter(e => e.is_connected_to_source_root && !/参考/.test(e.label ?? '')).map(e => e.target_node_id));
  return detail.groups.filter(g => direct.has(g.id)).flatMap(g => g.payments
    .filter(p => p.type === 'payee')
    .map(p => ({ ...p, groupId: g.id, amount: knownAmount(p.total_contract_amount, p.negative_total_contract_amount_count) })));
}

export function executionGraph(details: RsApiDetail[]): { nodes: UnifiedNode[]; edges: UnifiedEdge[] } {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const ministries = new Map<string, UnifiedNode>();
  const recipients = new Map<string, UnifiedNode>();
  for (const d of details) {
    const pid = d.projectId;
    const ministryId = `min-rs-${d.ministry}`;
    const execution = d.execution;
    // New/unexecuted projects may name expected recipients. Do not turn them into actual spending.
    const payments = execution !== null && execution > 0 ? directPayments(d).filter(p => p.amount !== null && p.amount > 0) : [];
    const spending = payments.reduce((sum, p) => sum + p.amount!, 0);
    // Unknown executions remain in the detail snapshot, but cannot be drawn as zero-valued facts.
    if (execution === null) continue;
    const ministry = ministries.get(ministryId) ?? { id: ministryId, col: 'ministry', name: d.ministry, value: 0 };
    ministry.value += execution;
    ministries.set(ministryId, ministry);
    nodes.push({ id: `project-budget-${pid}`, col: 'program', name: d.name, value: execution, kind: 'rs', projectId: pid, rsMinistry: d.ministry, sourceUrl: d.sourceUrl });
    if (execution > 0) edges.push({ source: ministryId, target: `project-budget-${pid}`, value: execution });
    if (!spending) continue;
    nodes.push({ id: `project-spending-${pid}`, col: 'program-spending', name: d.name, value: spending, projectId: pid, rsMinistry: d.ministry, sourceUrl: d.sourceUrl });
    edges.push({ source: `project-budget-${pid}`, target: `project-spending-${pid}`, value: spending });
    const projectRecipientAmounts = new Map<string, number>();
    for (const p of payments) {
      // "Other" entries are local to a project/block, never a single nationwide corporation.
      const key = p.is_others || /^(その他|其他)$/.test(p.name.trim()) ? `other:${pid}:${p.groupId}:${p.id}` : buildRecipientKey(p.name, p.corporate_number ?? '');
      const id = `recipient-${key}`;
      const recipient = recipients.get(id) ?? { id, col: 'recipient', name: p.name, value: 0,
        ...(/^\d{13}$/.test(key) ? { representativeCorporateNumber: key, corporateNumberCount: 1 } : {}) };
      recipient.value += p.amount!;
      recipients.set(id, recipient);
      projectRecipientAmounts.set(id, (projectRecipientAmounts.get(id) ?? 0) + p.amount!);
    }
    for (const [target, value] of projectRecipientAmounts) edges.push({ source: `project-spending-${pid}`, target, value });
  }
  return { nodes: [...ministries.values(), ...nodes, ...recipients.values()], edges };
}
