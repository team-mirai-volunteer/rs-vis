import type { RawNode, RawEdge, LayoutNode, LayoutLink } from '@/types/sankey-svg';
import { MARGIN, NODE_W, NODE_PAD, getColumn, sortPriority } from '@/app/lib/sankey-svg-constants';

// ── Client-side TopN filtering ──

type AggMember = { id: string; name: string; value: number; ministry?: string };

export function filterTopN(
  allNodes: RawNode[],
  allEdges: RawEdge[],
  topMinistry: number,
  topProject: number,
  topRecipient: number,
  recipientOffset: number,
  pinnedProjectId: string | null = null,
  includeZeroSpending: boolean = true,
  showAggRecipient: boolean = true,
  showAggProject: boolean = true,
  scaleBudgetToVisible: boolean = true,
  focusRelated: boolean = false,
  pinnedRecipientId: string | null = null,
  pinnedMinistryName: string | null = null,
  offsetTarget: 'recipient' | 'project' = 'recipient',
  projectOffset: number = 0,
  projectSortBy: 'budget' | 'spending' = 'budget',
): { nodes: RawNode[]; edges: RawEdge[]; totalRecipientCount: number; totalProjectCount: number; aggNodeMembers: Map<string, AggMember[]>; topProjectIds: Set<string> } {
  // Build O(1) lookup map
  const nodeById = new Map(allNodes.map(n => [n.id, n]));

  // Zero-spending exclusion sets (populated only when includeZeroSpending is false)
  const zeroSpendingProjectIds = new Set<string>();
  const zeroSpendingBudgetIds = new Set<string>();
  if (!includeZeroSpending) {
    for (const n of allNodes) {
      if (n.type === 'project-spending' && n.value === 0) {
        zeroSpendingProjectIds.add(n.id);
        if (n.projectId != null) zeroSpendingBudgetIds.add(`project-budget-${n.projectId}`);
      }
    }
  }

  // Focus modes (mutually exclusive; priority: recipient > ministry > project)
  const recipientFocusMode = focusRelated && pinnedRecipientId != null;
  const ministryFocusMode = focusRelated && pinnedMinistryName != null && !recipientFocusMode;
  const projectRecipientsMode = focusRelated && pinnedProjectId != null && !recipientFocusMode && !ministryFocusMode;

  // 1. TopN ministries by total value (stable ranking)
  const ministries = allNodes.filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value);
  let topMinistryNodes = ministries.slice(0, topMinistry);
  if (ministryFocusMode && pinnedMinistryName) {
    const pinned = ministries.find(n => n.name === pinnedMinistryName);
    topMinistryNodes = pinned ? [pinned] : [];
  }
  let otherMinistries = ministryFocusMode ? [] : ministries.slice(topMinistry);
  // Single-element aggregation: promote lone ministry to a regular node
  if (otherMinistries.length === 1) {
    topMinistryNodes = [...topMinistryNodes, otherMinistries[0]];
    otherMinistries = [];
  }
  const topMinistryIds = new Set(topMinistryNodes.map(n => n.id));
  const topMinistryNames = new Set(topMinistryNodes.map(n => n.name));

  // ── Project-offset mode: pre-compute project window before recipient window ──
  // Active when offsetTarget === 'project' and neither recipientFocus nor projectRecipients mode is engaged.
  // ministryFocusMode is compatible: the ranked list is restricted to the focused ministry.
  const projectOffsetMode = offsetTarget === 'project'
    && !recipientFocusMode && !projectRecipientsMode;

  let totalProjectCount = 0;
  let aboveWindowBudgetIds = new Set<string>();
  let aboveWindowSpendingIds = new Set<string>();   // excluded from effectivelyHiddenIds
  let projectOffsetWindowProjectIds = new Set<string>();
  let projectOffsetAggregateSpendingIds = new Set<string>();

  if (projectOffsetMode) {
    // Rank projects in top ministries by the chosen sort criterion, descending
    const ranked = allNodes
      .filter(n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || '') && !zeroSpendingProjectIds.has(n.id))
      .sort((a, b) => {
        if (projectSortBy === 'budget') {
          const ba = nodeById.get(`project-budget-${a.projectId}`)?.value ?? 0;
          const bb = nodeById.get(`project-budget-${b.projectId}`)?.value ?? 0;
          if (bb !== ba) return bb - ba;
          return b.value - a.value;
        }
        return b.value - a.value;
      });
    totalProjectCount = ranked.length;

    // Above-window: excluded entirely (pinned project is exempted)
    const aboveWindowProjects = ranked.slice(0, projectOffset).filter(n => n.id !== pinnedProjectId);
    aboveWindowSpendingIds = new Set(aboveWindowProjects.map(n => n.id));
    aboveWindowBudgetIds = new Set(
      aboveWindowProjects.filter(n => n.projectId != null).map(n => `project-budget-${n.projectId}`)
    );

    // Window projects: [projectOffset, projectOffset + topProject)
    const windowSlice = ranked.slice(projectOffset, projectOffset + topProject);
    // If pinned project is above-window, force it into the window
    if (pinnedProjectId) {
      const aboveWinIds = aboveWindowSpendingIds;
      if (aboveWinIds.has(pinnedProjectId) && !windowSlice.some(n => n.id === pinnedProjectId)) {
        const pinned = ranked.find(n => n.id === pinnedProjectId);
        if (pinned) windowSlice.push(pinned);
      }
    }
    projectOffsetWindowProjectIds = new Set(windowSlice.map(n => n.id));

    // Aggregate projects: [projectOffset + topProject, ...)
    projectOffsetAggregateSpendingIds = new Set(ranked.slice(projectOffset + topProject).map(n => n.id));
  }


  // 2. Recipient window — ranked by total amount across ALL edges (stable ranking)
  const allRecipientAmounts = new Map<string, number>();
  for (const e of allEdges) {
    if (e.target.startsWith('r-')) {
      allRecipientAmounts.set(e.target, (allRecipientAmounts.get(e.target) || 0) + e.value);
    }
  }
  const allSortedRecipients = Array.from(allRecipientAmounts.entries()).sort((a, b) => b[1] - a[1]);
  let totalRecipientCount = allSortedRecipients.length;

  let windowRecipients: [string, number][];
  let tailRecipients: [string, number][];
  let ministrySpecificSortedRecipients: [string, number][] = [];
  if (recipientFocusMode && pinnedRecipientId) {
    // Show only the one pinned recipient; no tail (projects are restricted in step 4)
    const totalFlow = allEdges.reduce((s, e) => e.target === pinnedRecipientId ? s + e.value : s, 0);
    windowRecipients = totalFlow > 0 ? [[pinnedRecipientId, totalFlow]] : [];
    tailRecipients = [];
  } else if (projectOffsetMode) {
    // Recipients ranked by flow from window projects only; no recipient offset.
    // Covers both normal mode and ministryFocusMode (window projects are already ministry-scoped).
    const windowProjectRecipAmounts = new Map<string, number>();
    for (const e of allEdges) {
      if (projectOffsetWindowProjectIds.has(e.source) && e.target.startsWith('r-')) {
        windowProjectRecipAmounts.set(e.target, (windowProjectRecipAmounts.get(e.target) || 0) + e.value);
      }
    }
    const sortedWindowProjectRecips = Array.from(windowProjectRecipAmounts.entries()).sort((a, b) => b[1] - a[1]);
    totalRecipientCount = sortedWindowProjectRecips.length;
    windowRecipients = sortedWindowProjectRecips.slice(0, topRecipient);
    tailRecipients = sortedWindowProjectRecips.slice(topRecipient);
  } else if (ministryFocusMode && pinnedMinistryName) {
    // Recipient window based on ministry-specific flows (supports offset scrolling)
    const ministryRecipientAmounts = new Map<string, number>();
    for (const e of allEdges) {
      const srcNode = nodeById.get(e.source);
      if (srcNode?.type === 'project-spending' && srcNode.ministry === pinnedMinistryName && e.target.startsWith('r-')) {
        ministryRecipientAmounts.set(e.target, (ministryRecipientAmounts.get(e.target) || 0) + e.value);
      }
    }
    ministrySpecificSortedRecipients = Array.from(ministryRecipientAmounts.entries()).sort((a, b) => b[1] - a[1]);
    totalRecipientCount = ministrySpecificSortedRecipients.length;
    windowRecipients = ministrySpecificSortedRecipients.slice(recipientOffset, recipientOffset + topRecipient);
    tailRecipients = ministrySpecificSortedRecipients.slice(recipientOffset + topRecipient);
  } else if (projectRecipientsMode) {
    const projectRecipientAmounts = new Map<string, number>();
    for (const e of allEdges) {
      if (e.source === pinnedProjectId && e.target.startsWith('r-')) {
        projectRecipientAmounts.set(e.target, (projectRecipientAmounts.get(e.target) || 0) + e.value);
      }
    }
    const sortedProjectRecipients = Array.from(projectRecipientAmounts.entries()).sort((a, b) => b[1] - a[1]);
    windowRecipients = sortedProjectRecipients.slice(0, topRecipient);
    tailRecipients = sortedProjectRecipients.slice(topRecipient);
  } else {
    windowRecipients = allSortedRecipients.slice(recipientOffset, recipientOffset + topRecipient);
    tailRecipients = allSortedRecipients.slice(recipientOffset + topRecipient);
  }
  // Single-element tail: promote lone recipient to window
  if (tailRecipients.length === 1) {
    windowRecipients = [...windowRecipients, tailRecipients[0]];
    tailRecipients = [];
  }
  const windowRecipientIds = new Set(windowRecipients.map(([id]) => id));
  const tailRecipientIds = new Set(tailRecipients.map(([id]) => id));

  // 3. Per-project and per-recipient window/tail spending (all projects, used for re-ranking)
  const projectWindowValue = new Map<string, number>();
  const recipientWindowValue = new Map<string, number>();
  const projectTailValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      projectWindowValue.set(e.source, (projectWindowValue.get(e.source) || 0) + e.value);
      // In projectOffsetMode, above-window projects have no visible nodes/edges.
      // Exclude their flow from recipientWindowValue so recipient heights match visible incoming edges.
      if (!projectOffsetMode || !aboveWindowSpendingIds.has(e.source)) {
        recipientWindowValue.set(e.target, (recipientWindowValue.get(e.target) || 0) + e.value);
      }
    } else if (tailRecipientIds.has(e.target)) {
      projectTailValue.set(e.source, (projectTailValue.get(e.source) || 0) + e.value);
    }
  }

  // Recipients before the window (rank 0..offset-1) are neither in window nor tail — their flow is hidden.
  // Compute per-project spending to these hidden recipients so we can subtract from node heights.
  // In projectRecipientsMode or recipientFocusMode, there is no offset concept — aboveWindow is always empty.
  // In ministryFocusMode, aboveWindow is computed from ministry-specific sorted recipients.
  const aboveWindowRecipientIds = (projectRecipientsMode || recipientFocusMode || projectOffsetMode)
    ? new Set<string>()
    : ministryFocusMode
      ? new Set(ministrySpecificSortedRecipients.slice(0, recipientOffset).map(([id]) => id))
      : new Set(allSortedRecipients.slice(0, recipientOffset).map(([id]) => id));
  const projectAboveWindowSpending = new Map<string, number>();
  if (!(projectRecipientsMode || recipientFocusMode || projectOffsetMode) && recipientOffset > 0) {
    for (const e of allEdges) {
      if (aboveWindowRecipientIds.has(e.target)) {
        projectAboveWindowSpending.set(e.source, (projectAboveWindowSpending.get(e.source) || 0) + e.value);
      }
    }
  }

  // 3b. Adjusted budget values: scale each project-budget by visible spending fraction.
  // visibleFraction = clamp(spendingValue / n.value, 0, 1)  (1 when n.value=0)
  // Only applied when scaleBudgetToVisible=true.
  const projectAdjustedBudget = new Map<string, number>();
  for (const n of allNodes) {
    if (n.type !== 'project-spending' || n.projectId == null) continue;
    const budgetNode = nodeById.get(`project-budget-${n.projectId}`);
    if (!budgetNode) continue;
    const sv = (recipientFocusMode || !showAggRecipient)
      ? (projectWindowValue.get(n.id) || 0)
      : n.value - (projectAboveWindowSpending.get(n.id) || 0);
    const fraction = (scaleBudgetToVisible && n.value > 0) ? Math.max(0, Math.min(1, sv / n.value)) : 1;
    projectAdjustedBudget.set(`project-budget-${n.projectId}`, budgetNode.value * fraction);
  }

  // 4. TopN projects re-ranked by WINDOW spending (dynamic as offset changes)
  //    Scope: projects belonging to top ministries only
  const topMinistryAllProjects = allNodes.filter(
    n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || '') && !zeroSpendingProjectIds.has(n.id)
  );
  topMinistryAllProjects.sort((a, b) => {
    // projectSortBy='budget' is only meaningful in project-offset mode where there is no recipient
    // offset and raw budget order is stable. In recipient-offset mode the adjusted budget
    // (rawBudget × visible-fraction) still ranks large-budget projects above small-budget ones
    // even when their window spending is far lower, so always sort by window spending instead.
    if (projectSortBy === 'budget' && projectOffsetMode) {
      const ba = projectAdjustedBudget.get(`project-budget-${a.projectId}`) ?? nodeById.get(`project-budget-${a.projectId}`)?.value ?? 0;
      const bb = projectAdjustedBudget.get(`project-budget-${b.projectId}`) ?? nodeById.get(`project-budget-${b.projectId}`)?.value ?? 0;
      if (bb !== ba) return bb - ba;
    }
    // Use window + tail (= visible spending) so the aggregate recipient's contribution is included.
    const va = (projectWindowValue.get(a.id) || 0) + (showAggRecipient ? (projectTailValue.get(a.id) || 0) : 0);
    const vb = (projectWindowValue.get(b.id) || 0) + (showAggRecipient ? (projectTailValue.get(b.id) || 0) : 0);
    return vb - va;
  });
  // Filter before slice so that projects with no visible flow don't consume TopN slots.
  const topProjectNodes = topMinistryAllProjects
    .filter(n => n.id === pinnedProjectId || includeZeroSpending
      || (projectWindowValue.get(n.id) || 0) > 0
      || (showAggRecipient && (projectTailValue.get(n.id) || 0) > 0))
    .slice(0, topProject);
  // Pin: force-include the pinned project (TopN+1) if not already present
  if (pinnedProjectId) {
    const pinned = allNodes.find(n => n.id === pinnedProjectId && n.type === 'project-spending');
    if (pinned && (includeZeroSpending || !zeroSpendingProjectIds.has(pinned.id)) && !topProjectNodes.some(n => n.id === pinnedProjectId)) {
      topProjectNodes.push(pinned);
    }
  }
  // In projectRecipientsMode: restrict to the pinned project only
  if (projectRecipientsMode && pinnedProjectId) {
    topProjectNodes.splice(0, topProjectNodes.length, ...topProjectNodes.filter(n => n.id === pinnedProjectId));
  }
  // In recipientFocusMode: show projects (any ministry) that have flow to the pinned recipient, with TopN aggregation
  let recipientFocusOtherProjects: RawNode[] = [];
  if (recipientFocusMode && pinnedRecipientId) {
    const flowToRecipient = new Map<string, number>();
    for (const e of allEdges) {
      if (e.target === pinnedRecipientId) {
        flowToRecipient.set(e.source, (flowToRecipient.get(e.source) || 0) + e.value);
      }
    }
    const allRecipientProjects = allNodes
      .filter(n => n.type === 'project-spending' && flowToRecipient.has(n.id))
      .sort((a, b) => (flowToRecipient.get(b.id) || 0) - (flowToRecipient.get(a.id) || 0));
    topProjectNodes.splice(0, topProjectNodes.length, ...allRecipientProjects.slice(0, topProject));
    recipientFocusOtherProjects = allRecipientProjects.slice(topProject);
  }
  const topProjectIds = new Set(topProjectNodes.map(n => n.id));

  // In projectOffsetMode: replace topProjectNodes with the pre-computed window set.
  // Use topMinistryAllProjects (already sorted) instead of allNodes to preserve sort order.
  if (projectOffsetMode) {
    topProjectNodes.splice(0, topProjectNodes.length, ...topMinistryAllProjects.filter(n => projectOffsetWindowProjectIds.has(n.id)));
    topProjectIds.clear();
    topProjectNodes.forEach(n => topProjectIds.add(n.id));
  }

  // totalProjectCount: always reflect the current context so the slider label is accurate.
  // In projectOffsetMode it was already set; fill it for other modes here.
  if (!projectOffsetMode) {
    if (ministryFocusMode && pinnedMinistryName) {
      totalProjectCount = allNodes.filter(
        n => n.type === 'project-spending' && n.ministry === pinnedMinistryName && !zeroSpendingProjectIds.has(n.id)
      ).length;
    } else {
      // recipientFocusMode / projectRecipientsMode: project offset is overridden by focus,
      // but still return a valid count so the slider label is not "Top 1〜0 /0件".
      totalProjectCount = topMinistryAllProjects.length;
    }
  }

  // When showAggProject is OFF, recipient heights should reflect only top-project inflow
  // (aggregate project → recipient edges are hidden, so their contribution is excluded).
  const recipientValueFromTopProjects = showAggProject ? null : (() => {
    const m = new Map<string, number>();
    for (const e of allEdges) {
      if (topProjectIds.has(e.source) && windowRecipientIds.has(e.target)) {
        m.set(e.target, (m.get(e.target) || 0) + e.value);
      }
    }
    return m;
  })();

  // Projects that originally have spending (node.value > 0) but have no flow to any visible recipient
  // (neither window nor tail — all spending goes to above-window recipients only) are effectively hidden.
  // Projects with tail-only flow remain in aggregation and ministry totals.
  // Pinned projects are exempted: they are kept visible even when effectively hidden so that
  // ministryBudgetValue and project budget columns stay in sync.
  // This is computed purely from current state (path-independent).
  const effectivelyHiddenIds = new Set(
    allNodes
      .filter(n => n.type === 'project-spending' && n.value > 0
        && n.id !== pinnedProjectId  // only the pinned project is exempt; top-N rank alone is not enough
        && !aboveWindowSpendingIds.has(n.id)  // above-window projects excluded via their own path
        // In projectOffsetMode, aggregate projects are always shown via the aggregate node
        // regardless of recipient overlap with the window — never treat them as effectively hidden.
        && !projectOffsetAggregateSpendingIds.has(n.id)
        && (projectWindowValue.get(n.id) || 0) === 0
        && (!showAggRecipient || (projectTailValue.get(n.id) || 0) === 0))
      .map(n => n.id)
  );
  const effectivelyHiddenBudgetIds = new Set(
    allNodes
      .filter(n => n.type === 'project-spending' && effectivelyHiddenIds.has(n.id) && n.projectId != null)
      .map(n => `project-budget-${n.projectId}`)
  );

  const otherMinistryProjects = allNodes.filter(
    n => n.type === 'project-spending' && !topMinistryNames.has(n.ministry || '') && !topProjectIds.has(n.id) && !effectivelyHiddenIds.has(n.id) && !zeroSpendingProjectIds.has(n.id)
  );
  let otherProjects: RawNode[] = recipientFocusMode ? recipientFocusOtherProjects
    : projectRecipientsMode ? []
    : projectOffsetMode ? [
      ...allNodes.filter(n => projectOffsetAggregateSpendingIds.has(n.id) && !effectivelyHiddenIds.has(n.id)),
      // In ministryFocusMode, other-ministry projects are hidden (focus scope is one ministry)
      ...(ministryFocusMode ? [] : otherMinistryProjects),
    ]
    : ministryFocusMode ? topMinistryAllProjects.filter(n => !topProjectIds.has(n.id) && !effectivelyHiddenIds.has(n.id))
    : [
    ...topMinistryAllProjects.filter(n => !topProjectIds.has(n.id) && !effectivelyHiddenIds.has(n.id)),
    ...otherMinistryProjects,
  ];
  // Single-element aggregation: promote lone project to a regular node
  if (otherProjects.length === 1) {
    topProjectNodes.push(otherProjects[0]);
    topProjectIds.add(otherProjects[0].id);
    otherProjects = [];
  }
  const otherProjectSpendingIds = new Set(otherProjects.map(n => n.id));
  const otherProjectBudgetIds = new Set(otherProjects.filter(n => n.projectId != null).map(n => `project-budget-${n.projectId}`));

  // 5. Aggregated values
  let otherProjectWindowTotal = 0;
  let otherProjectTailTotal = 0;
  const otherProjectsWithFlow = new Set<string>();
  for (const e of allEdges) {
    if (!otherProjectSpendingIds.has(e.source)) continue;
    if (windowRecipientIds.has(e.target)) {
      otherProjectWindowTotal += e.value;
      otherProjectsWithFlow.add(e.source);
    } else if (tailRecipientIds.has(e.target)) {
      otherProjectTailTotal += e.value;
      otherProjectsWithFlow.add(e.source);
    }
  }
  // In projectOffsetMode: aggregate projects can flow to recipients outside the window/tail scope.
  // Compute their total flow and unique count so __agg-recipient reflects all non-shown recipients.
  let otherProjectAggOnlyTotal = 0;
  let aggOnlyRecipientCount = 0;
  if (projectOffsetMode) {
    const aggOnlyRecips = new Set<string>();
    for (const e of allEdges) {
      if (otherProjectSpendingIds.has(e.source) && e.target.startsWith('r-')
          && !windowRecipientIds.has(e.target) && !tailRecipientIds.has(e.target)) {
        otherProjectAggOnlyTotal += e.value;
        aggOnlyRecips.add(e.target);
      }
    }
    aggOnlyRecipientCount = aggOnlyRecips.size;
    // Merge into otherProjectTailTotal so the __agg-project-spending → __agg-recipient edge includes this flow
    otherProjectTailTotal += otherProjectAggOnlyTotal;
  }

  // Sum of adjusted budget amounts for aggregated projects (budget-column height basis).
  const otherProjectBudgetTotal = otherProjects.reduce((s, p) => {
    if (p.projectId == null) return s;
    const budgetId = `project-budget-${p.projectId}`;
    return s + (projectAdjustedBudget.get(budgetId) ?? nodeById.get(budgetId)?.value ?? 0);
  }, 0);
  const otherProjectBudgetRawTotal = otherProjects.reduce((s, p) => {
    return s + (p.projectId != null ? (nodeById.get(`project-budget-${p.projectId}`)?.value ?? 0) : 0);
  }, 0);

  const totalWindowSpending = windowRecipients.reduce((s, [, v]) => s + v, 0);

  // 6. Ministry window values (for edge widths)
  const ministryWindowValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      const spNode = nodeById.get(e.source);
      if (spNode?.type === 'project-spending' && spNode.ministry) {
        ministryWindowValue.set(spNode.ministry, (ministryWindowValue.get(spNode.ministry) || 0) + e.value);
      }
    }
  }
  const otherMinistryWindowValue = otherMinistries.reduce((s, n) => s + (ministryWindowValue.get(n.name) || 0), 0);

  // 7. Ministry budget totals (sum of project-budget values per ministry — for node heights)
  // Exclude effectively hidden projects (had spending but lost window flow at current offset)
  // In projectRecipientsMode: only count the pinned project's budget.
  // In recipientFocusMode: only count budgets for projects flowing to the pinned recipient.
  const pinnedBudgetId = projectRecipientsMode && pinnedProjectId
    ? `project-budget-${allNodes.find(n => n.id === pinnedProjectId)?.projectId}`
    : null;
  // Include both topProjectNodes and otherProjects (aggregated) so that ministry/total budget is complete.
  const recipientFocusProjectBudgetIds = recipientFocusMode
    ? new Set([
        ...topProjectNodes.filter(n => n.projectId != null).map(n => `project-budget-${n.projectId}`),
        ...otherProjects.filter(n => n.projectId != null).map(n => `project-budget-${n.projectId}`),
      ])
    : null;
  const ministryBudgetValue = new Map<string, number>();
  const ministryBudgetRawValue = new Map<string, number>();
  for (const n of allNodes) {
    if (n.type === 'project-budget' && n.ministry) {
      if (projectRecipientsMode && n.id !== pinnedBudgetId) continue;
      if (recipientFocusMode && !recipientFocusProjectBudgetIds?.has(n.id)) continue;
      if (ministryFocusMode && n.ministry !== pinnedMinistryName) continue;
      if (effectivelyHiddenBudgetIds.has(n.id)) continue;
      if (zeroSpendingBudgetIds.has(n.id)) continue;
      if (aboveWindowBudgetIds.has(n.id)) continue;
      if (!showAggProject && otherProjectBudgetIds.has(n.id)) continue;
      const adjValue = projectAdjustedBudget.get(n.id) ?? n.value;
      ministryBudgetValue.set(n.ministry, (ministryBudgetValue.get(n.ministry) || 0) + adjValue);
      ministryBudgetRawValue.set(n.ministry, (ministryBudgetRawValue.get(n.ministry) || 0) + n.value);
    }
  }
  // Fallback spending value per ministry — used when all visible projects have 0 budget.
  // Must apply the same focus-mode filters as ministryBudgetValue to avoid showing unrelated ministries.
  const recipientFocusProjectSpendingIds = recipientFocusProjectBudgetIds
    ? new Set([
        ...topProjectNodes.filter(n => n.projectId != null).map(n => n.id),
        ...otherProjects.filter(n => n.projectId != null).map(n => n.id),
      ])
    : null;
  const ministrySpendingValue = new Map<string, number>();
  for (const n of allNodes) {
    if (n.type === 'project-spending' && n.ministry) {
      if (projectRecipientsMode && n.id !== pinnedProjectId) continue;
      if (recipientFocusMode && !recipientFocusProjectSpendingIds?.has(n.id)) continue;
      if (ministryFocusMode && n.ministry !== pinnedMinistryName) continue;
      if (effectivelyHiddenIds.has(n.id)) continue;
      if (zeroSpendingProjectIds.has(n.id)) continue;
      if (aboveWindowSpendingIds.has(n.id)) continue;
      if (!showAggProject && otherProjectSpendingIds.has(n.id)) continue;
      const sv = (recipientFocusMode || !showAggRecipient)
        ? (projectWindowValue.get(n.id) || 0)
        : n.value - (projectAboveWindowSpending.get(n.id) || 0);
      if (sv > 0) ministrySpendingValue.set(n.ministry, (ministrySpendingValue.get(n.ministry) || 0) + sv);
    }
  }
  const totalBudget = Array.from(ministryBudgetValue.values()).reduce((s, v) => s + v, 0);
  const totalBudgetRaw = Array.from(ministryBudgetRawValue.values()).reduce((s, v) => s + v, 0);
  const otherMinistryBudgetValue = otherMinistries.reduce((s, n) => s + (ministryBudgetValue.get(n.name) || 0), 0);
  const otherMinistryBudgetRawValue = otherMinistries.reduce((s, n) => s + (ministryBudgetRawValue.get(n.name) || 0), 0);
  const otherMinistrySpendingValue = otherMinistries.reduce((s, n) => s + (ministrySpendingValue.get(n.name) || 0), 0);

  // ── Build nodes ──
  const nodes: RawNode[] = [];
  const totalNode = allNodes.find(n => n.type === 'total');
  if (totalNode) {
    nodes.push({ ...totalNode, value: totalBudget, rawValue: totalBudgetRaw, isScaled: totalBudget < totalBudgetRaw, skipLinkOverride: true });
  }

  // In recipientFocusMode, iterate all ministries so non-top ministries with relevant projects appear.
  const ministryNodesToShow = recipientFocusMode ? ministries : topMinistryNodes;
  for (const n of ministryNodesToShow) {
    const bv = ministryBudgetValue.get(n.name) || 0;
    const rawBv = ministryBudgetRawValue.get(n.name) || 0;
    // Show ministry node when budget > 0, or when there are visible projects with spending
    // (budget = 0 case: node value is 0 so amounts stay consistent).
    const hasVisibleSpending = (ministrySpendingValue.get(n.name) || 0) > 0;
    if (bv > 0 || hasVisibleSpending) {
      nodes.push({ ...n, value: bv, rawValue: rawBv || undefined, isScaled: bv > 0 && bv < rawBv, skipLinkOverride: true });
    }
  }
  if (!recipientFocusMode && (otherMinistryBudgetValue > 0 || otherMinistrySpendingValue > 0)) {
    nodes.push({ id: '__agg-ministry', name: `${otherMinistries.length.toLocaleString()}省庁`, type: 'ministry', value: otherMinistryBudgetValue, rawValue: otherMinistryBudgetRawValue, isScaled: otherMinistryBudgetValue < otherMinistryBudgetRawValue, skipLinkOverride: true, aggregated: true });
  }

  for (const n of topProjectNodes) {
    if (effectivelyHiddenIds.has(n.id)) continue;
    // spending node height = window spending only (agg hidden) or total minus above-window (normal).
    const spendingValue = (recipientFocusMode || !showAggRecipient)
      ? (projectWindowValue.get(n.id) || 0)
      : n.value - (projectAboveWindowSpending.get(n.id) || 0);
    const spendingTrimmed = spendingValue < n.value;
    // layoutSortValue: determines vertical position — must match topMinistryAllProjects sort key.
    // project-offset + budget sort → adjusted budget; otherwise → visible spending (window + tail).
    // Use spendingValue (= window + tail) rather than windowValue alone so the aggregate
    // recipient's contribution is included in the sort, matching the displayed node height.
    const layoutSortBase = (projectSortBy === 'budget' && projectOffsetMode)
      ? (projectAdjustedBudget.get(`project-budget-${n.projectId}`) ?? nodeById.get(`project-budget-${n.projectId}`)?.value ?? n.value)
      : spendingValue;
    const budgetNode = nodeById.get(`project-budget-${n.projectId}`);
    // Budget height = adjusted budget (scaled by visible spending fraction when scaleBudgetToVisible).
    // rawValue preserves original budget for label display.
    if (budgetNode) {
      const adjBv = projectAdjustedBudget.get(budgetNode.id) ?? budgetNode.value;
      nodes.push({ ...budgetNode, value: adjBv, rawValue: budgetNode.value, isScaled: adjBv < budgetNode.value, layoutSortValue: layoutSortBase, skipLinkOverride: true });
    }
    nodes.push({ ...n, value: spendingValue, rawValue: spendingTrimmed ? n.value : undefined, isScaled: spendingTrimmed, layoutSortValue: layoutSortBase, skipLinkOverride: true });
  }
  // Compute aggregate spending total independently of budget so zero-budget aggregate projects
  // still get a spending node (budget and spending gates are evaluated separately).
  const otherProjectSpendingTotal = (recipientFocusMode || !showAggRecipient)
    ? otherProjectWindowTotal
    : otherProjects.reduce((s, p) => s + p.value - (projectAboveWindowSpending.get(p.id) || 0), 0);
  const otherProjectSpendingRawTotal = otherProjects.reduce((s, p) => s + p.value, 0);
  // Create __agg-project-budget whenever aggregate projects have spending to show
  // (budget may be 0, in which case the node has height 0 but still anchors the merged shape label).
  if (otherProjectSpendingTotal > 0 && showAggProject) {
    nodes.push({ id: '__agg-project-budget', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-budget', value: otherProjectBudgetTotal, rawValue: otherProjectBudgetRawTotal, isScaled: otherProjectBudgetTotal < otherProjectBudgetRawTotal, skipLinkOverride: true, aggregated: true });
  }
  // Create __agg-project-spending when aggregate projects have spending.
  if (otherProjectSpendingTotal > 0 && showAggProject) {
    const aggSpendingTrimmed = otherProjectSpendingTotal < otherProjectSpendingRawTotal;
    nodes.push({ id: '__agg-project-spending', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-spending', value: otherProjectSpendingTotal, rawValue: aggSpendingTrimmed ? otherProjectSpendingRawTotal : undefined, isScaled: aggSpendingTrimmed, skipLinkOverride: true, aggregated: true });
  }

  for (const [rid, pinnedAmt] of windowRecipients) {
    const rNode = nodeById.get(rid);
    if (rNode) {
      const val = (projectRecipientsMode || ministryFocusMode) ? pinnedAmt
        : recipientValueFromTopProjects ? (recipientValueFromTopProjects.get(rid) || 0)
        : (recipientWindowValue.get(rid) || 0);
      nodes.push({ ...rNode, value: val, skipLinkOverride: true });
    }
  }
  // tailValue = total inflow to rank (offset+topRecipient)+ recipients from ALL projects.
  // otherProjectTailTotal is a subset of tailValue (aggregated projects' tail flow),
  // so it must NOT be added separately — that would double-count.
  // Subtract effectively hidden projects' tail spending (excluded from project-spending column).
  const hiddenTailSpending = effectivelyHiddenIds.size > 0
    ? allEdges.filter(e => effectivelyHiddenIds.has(e.source) && tailRecipientIds.has(e.target))
              .reduce((s, e) => s + e.value, 0)
    : 0;
  const tailValue = tailRecipients.reduce((s, [, v]) => s + v, 0) - hiddenTailSpending;
  // In projectOffsetMode, include aggregate-project-only recipient flow in the node check value.
  const aggRecipientValue = tailValue + otherProjectAggOnlyTotal;
  const aggRecipientCount = tailRecipients.length + aggOnlyRecipientCount;
  if (showAggRecipient && aggRecipientValue > 0) {
    nodes.push({
      id: '__agg-recipient',
      name: `${aggRecipientCount.toLocaleString()}支出先`,
      type: 'recipient',
      value: aggRecipientValue,
      // No skipLinkOverride: height auto-computed from incoming edges (includes agg-project flow)
      aggregated: true,
    });
  }

  // ── Build edges ──
  const edges: RawEdge[] = [];

  // total → ministry (budget-based; 0-value edge emitted when budget = 0 so hierarchy is visible)
  // In recipientFocusMode, use ministryNodesToShow (all ministries) instead of topMinistryNodes only
  for (const mn of ministryNodesToShow) {
    const bv = ministryBudgetValue.get(mn.name) || 0;
    const hasVisibleSpending = (ministrySpendingValue.get(mn.name) || 0) > 0;
    if (bv > 0 || hasVisibleSpending) edges.push({ source: 'total', target: mn.id, value: bv });
  }
  if (!recipientFocusMode && (otherMinistryBudgetValue > 0 || otherMinistrySpendingValue > 0)) {
    edges.push({ source: 'total', target: '__agg-ministry', value: otherMinistryBudgetValue });
  }

  // ministry → project-budget (adjusted budget-based)
  // In recipientFocusMode, non-top-ministry projects map to their own ministry node (not __agg-ministry)
  const visibleMinistryNames = recipientFocusMode
    ? new Set(topProjectNodes.map(n => n.ministry).filter(Boolean) as string[])
    : topMinistryNames;
  for (const n of topProjectNodes) {
    if (effectivelyHiddenIds.has(n.id)) continue;
    const budgetId = `project-budget-${n.projectId}`;
    const bv = projectAdjustedBudget.get(budgetId) ?? nodeById.get(budgetId)?.value ?? 0;
    const ministrySource = visibleMinistryNames.has(n.ministry || '') ? `ministry-${n.ministry}` : '__agg-ministry';
    // Emit edge even when bv = 0 so hierarchy remains visible (0-value edges render as hairlines)
    edges.push({ source: ministrySource, target: budgetId, value: bv });
  }
  if (otherProjectSpendingTotal > 0 && showAggProject) {
    for (const mn of topMinistryNodes) {
      const hasAggProjects = otherProjects.some(p => p.ministry === mn.name);
      if (!hasAggProjects) continue;
      const v = otherProjects
        .filter(p => p.ministry === mn.name && p.projectId != null)
        .reduce((s, p) => {
          const budgetId = `project-budget-${p.projectId}`;
          return s + (projectAdjustedBudget.get(budgetId) ?? nodeById.get(budgetId)?.value ?? 0);
        }, 0);
      edges.push({ source: mn.id, target: '__agg-project-budget', value: v });
    }
    const otherMinRemain = otherProjects
      .filter(p => !topMinistryNames.has(p.ministry || '') && p.projectId != null)
      .reduce((s, p) => {
        const budgetId = `project-budget-${p.projectId}`;
        return s + (projectAdjustedBudget.get(budgetId) ?? nodeById.get(budgetId)?.value ?? 0);
      }, 0);
    const hasOtherMinAggProjects = otherProjects.some(p => !topMinistryNames.has(p.ministry || ''));
    if (hasOtherMinAggProjects) edges.push({ source: '__agg-ministry', target: '__agg-project-budget', value: otherMinRemain });
  }

  // project-budget → project-spending (adjusted budget-based; 0-value edges emitted for hierarchy)
  for (const n of topProjectNodes) {
    if (effectivelyHiddenIds.has(n.id)) continue;
    const budgetId = `project-budget-${n.projectId}`;
    const bv = projectAdjustedBudget.get(budgetId) ?? nodeById.get(budgetId)?.value ?? 0;
    edges.push({ source: budgetId, target: n.id, value: bv });
  }
  if (otherProjectSpendingTotal > 0 && showAggProject) {
    edges.push({ source: '__agg-project-budget', target: '__agg-project-spending', value: otherProjectBudgetTotal });
  }

  // project-spending → window recipients
  const topProjectSpendingIds = new Set(topProjectNodes.filter(n => !effectivelyHiddenIds.has(n.id)).map(n => n.id));
  for (const e of allEdges) {
    if (topProjectSpendingIds.has(e.source) && windowRecipientIds.has(e.target)) edges.push(e);
  }
  // project-spending → __agg-recipient (tail) — skipped when agg-recipient is hidden
  if (showAggRecipient) {
    for (const sp of topProjectNodes) {
      const v = allEdges.filter(e => e.source === sp.id && tailRecipientIds.has(e.target)).reduce((s, e) => s + e.value, 0);
      if (v > 0) edges.push({ source: sp.id, target: '__agg-recipient', value: v });
    }
  }

  // __agg-project-spending → window recipients — skipped when agg-project is hidden
  if (showAggProject) {
    for (const rid of windowRecipientIds) {
      const v = allEdges.filter(e => otherProjectSpendingIds.has(e.source) && e.target === rid).reduce((s, e) => s + e.value, 0);
      if (v > 0) edges.push({ source: '__agg-project-spending', target: rid, value: v });
    }
  }
  // __agg-project-spending → __agg-recipient (tail) — skipped when agg-recipient or agg-project is hidden
  if (showAggProject && showAggRecipient && otherProjectTailTotal > 0) {
    edges.push({ source: '__agg-project-spending', target: '__agg-recipient', value: otherProjectTailTotal });
  }

  // Build aggregation membership map for side panel display
  const aggNodeMembers = new Map<string, { id: string; name: string; value: number; ministry?: string }[]>();
  // __agg-ministry → actual ministry nodes
  if (otherMinistries.length > 0) {
    aggNodeMembers.set('__agg-ministry', otherMinistries.map(n => ({
      id: n.id, name: n.name, value: ministryBudgetValue.get(n.name) || 0,
    })).sort((a, b) => b.value - a.value));
  }
  // __agg-project-budget / __agg-project-spending → actual project-budget nodes
  if (otherProjects.length > 0) {
    const projectBudgetMembers = otherProjects.map(sp => {
      const bn = sp.projectId != null ? nodeById.get(`project-budget-${sp.projectId}`) : undefined;
      return { id: bn?.id ?? `project-budget-${sp.projectId}`, name: sp.name, value: bn?.value ?? 0, ministry: sp.ministry };
    }).sort((a, b) => b.value - a.value);
    aggNodeMembers.set('__agg-project-budget', projectBudgetMembers);
    aggNodeMembers.set('__agg-project-spending', otherProjects.map(sp => ({
      id: sp.id, name: sp.name, value: sp.value, ministry: sp.ministry,
    })).sort((a, b) => b.value - a.value));
  }
  // __agg-recipient → tail recipient nodes
  if (tailRecipients.length > 0) {
    aggNodeMembers.set('__agg-recipient', tailRecipients.map(([id, value]) => {
      const n = nodeById.get(id);
      return { id, name: n?.name ?? id, value };
    }));
  }

  return { nodes, edges, totalRecipientCount, totalProjectCount, aggNodeMembers, topProjectIds };
}

// ── Custom Layout Engine ──

export function computeLayout(filteredNodes: RawNode[], filteredEdges: RawEdge[], containerWidth: number, containerHeight: number, minNodeGap: number = NODE_PAD) {
  const innerW = containerWidth - MARGIN.left - MARGIN.right;
  const innerH = containerHeight - MARGIN.top - MARGIN.bottom;
  const usedCols = new Set<number>();
  for (const n of filteredNodes) usedCols.add(getColumn(n));
  const maxCol = Math.max(...usedCols, 1);
  const colSpacing = (innerW - NODE_W) / maxCol;

  const nodeMap = new Map<string, LayoutNode>();
  for (const n of filteredNodes) {
    nodeMap.set(n.id, { ...n, x0: 0, x1: 0, y0: 0, y1: 0, sourceLinks: [], targetLinks: [] });
  }

  const links: LayoutLink[] = [];
  for (const l of filteredEdges) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;
    const link: LayoutLink = { source: src, target: tgt, value: l.value, sourceWidth: 0, targetWidth: 0, y0: 0, y1: 0 };
    links.push(link);
    src.sourceLinks.push(link);
    tgt.targetLinks.push(link);
  }

  const nodes = Array.from(nodeMap.values());
  for (const node of nodes) {
    const srcSum = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const tgtSum = node.targetLinks.reduce((s, l) => s + l.value, 0);
    const linkValue = Math.max(srcSum, tgtSum);
    if (linkValue > 0 && !node.skipLinkOverride) node.value = linkValue;
    // Apply layout cap: preserve actual value in rawValue, shrink value for height computation
    if (node.layoutCap !== undefined && node.value > node.layoutCap) {
      node.rawValue = node.value;
      node.value = node.layoutCap;
    }
  }

  const columns: Map<number, LayoutNode[]> = new Map();
  for (const node of nodes) {
    const col = getColumn(node);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  for (const [, colNodes] of columns) {
    colNodes.sort((a, b) => {
      const ap = sortPriority(a);
      const bp = sortPriority(b);
      if (ap !== bp) return ap - bp;
      return (b.layoutSortValue ?? b.value) - (a.layoutSortValue ?? a.value);
    });
  }

  const effectivePad = Math.max(NODE_PAD, minNodeGap);

  // Compute the total rendered column height at a given ky using the exact same
  // gap rule used in placement below.
  const colHeight = (colNodes: RawNode[], candidateKy: number): number => {
    let total = 0;
    for (const node of colNodes) {
      const h = Math.max(1, node.value * candidateKy);
      const gap = (effectivePad > NODE_PAD && h < effectivePad) ? effectivePad : NODE_PAD;
      total += h + gap;
    }
    return total;
  };

  // Binary-search for the largest ky such that every column fits within innerH.
  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + n.value, 0);
    if (totalValue <= 0) continue;
    let lo = 0;
    let hi = innerH / totalValue;  // upper bound: ignores floor(1) and gap overhead
    // Expand hi until the column fits at hi (lo stays valid lower bound of ky)
    while (colHeight(colNodes, hi) > innerH && hi > 1e-9) hi /= 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (colHeight(colNodes, mid) <= innerH) lo = mid; else hi = mid;
    }
    ky = Math.min(ky, lo);
  }
  // ky=0 is valid: column gap overhead alone exceeds innerH — all nodes get minimum height (1px).
  // Only fall back to ky=1 when no column was processed (all columns empty).
  if (!isFinite(ky)) ky = 1;

  for (const [col, colNodes] of columns) {
    for (const node of colNodes) {
      node.x0 = col * colSpacing;
      node.x1 = node.x0 + NODE_W;
    }
    let y = 0;
    for (const node of colNodes) {
      const h = Math.max(1, node.value * ky);
      node.y0 = y;
      node.y1 = y + h;
      // Apply extra gap only for small nodes (those whose label would be hidden in OFF mode)
      const gap = (effectivePad > NODE_PAD && h < effectivePad) ? effectivePad : NODE_PAD;
      y += h + gap;
    }
  }

  // Sort links by target/source y-position so ribbons don't cross unnecessarily
  for (const node of nodes) {
    node.sourceLinks.sort((a, b) => a.target.y0 - b.target.y0);
    node.targetLinks.sort((a, b) => a.source.y0 - b.source.y0);
  }

  for (const node of nodes) {
    const nodeHeight = node.y1 - node.y0;
    const totalSrcValue = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const totalTgtValue = node.targetLinks.reduce((s, l) => s + l.value, 0);
    const MIN_LINK_W = 1; // minimum ribbon width in px for zero-value edges
    let sy = node.y0;
    for (const link of node.sourceLinks) {
      if (link.value === 0) {
        link.sourceWidth = MIN_LINK_W;
        link.y0 = node.y0; // all zero-value links originate from the same point
      } else {
        const proportion = totalSrcValue > 0 ? link.value / totalSrcValue : 0;
        link.sourceWidth = nodeHeight * proportion;
        link.y0 = sy;
        sy += link.sourceWidth;
      }
    }
    let ty = node.y0;
    for (const link of node.targetLinks) {
      if (link.value === 0) {
        link.targetWidth = MIN_LINK_W;
        link.y1 = node.y0; // all zero-value links arrive at the same point
      } else {
        const proportion = totalTgtValue > 0 ? link.value / totalTgtValue : 0;
        link.targetWidth = nodeHeight * proportion;
        link.y1 = ty;
        ty += link.targetWidth;
      }
    }
  }

  // ── Project node merging: position spending adjacent to budget, shift recipients ──
  // 1. Shift recipient nodes left by one colSpacing (project-spending col visually merges into budget col)
  for (const node of nodes) {
    if (node.type === 'recipient') {
      node.x0 -= colSpacing;
      node.x1 -= colSpacing;
    }
  }
  // 2. Move project-spending nodes to be horizontally adjacent to their paired budget node (top-aligned)
  //    Then re-compute their source link y0 positions accordingly.
  for (const node of nodes) {
    let budgetNode: LayoutNode | undefined;
    if (node.type === 'project-spending' && node.projectId != null) {
      budgetNode = nodeMap.get(`project-budget-${node.projectId}`);
    } else if (node.id === '__agg-project-spending') {
      budgetNode = nodeMap.get('__agg-project-budget');
    }
    if (!budgetNode) continue;
    const spendingHeight = node.y1 - node.y0;
    const newY0 = budgetNode.y0;
    node.x0 = budgetNode.x1;
    node.x1 = budgetNode.x1 + NODE_W;  // spending width = NODE_W → total merged = 2×NODE_W
    // Re-compute source link y0 positions (spending → recipient ribbons)
    let sy = newY0;
    for (const link of node.sourceLinks) {
      if (link.value === 0) { link.y0 = newY0; continue; } // preserve MIN_LINK_W, update origin
      link.y0 = sy;
      sy += link.sourceWidth;
    }
    node.y0 = newY0;
    node.y1 = newY0 + spendingHeight;
  }

  // 3. Repack recipient targetLinks — spending y0 positions changed, so resort and reassign y1
  const affectedRecipients = new Set<LayoutNode>();
  for (const node of nodes) {
    if ((node.type === 'project-spending' && node.projectId != null) || node.id === '__agg-project-spending') {
      for (const link of node.sourceLinks) affectedRecipients.add(link.target);
    }
  }
  for (const recipient of affectedRecipients) {
    recipient.targetLinks.sort((a, b) => a.source.y0 - b.source.y0);
    const recipientH = recipient.y1 - recipient.y0;
    const totalTgt = recipient.targetLinks.reduce((s, l) => s + l.value, 0);
    let ty = recipient.y0;
    for (const link of recipient.targetLinks) {
      if (link.value === 0) { link.y1 = recipient.y0; continue; } // preserve MIN_LINK_W, update origin
      link.targetWidth = totalTgt > 0 ? recipientH * (link.value / totalTgt) : 0;
      link.y1 = ty;
      ty += link.targetWidth;
    }
  }

  // Content bounding box (in inner coords, before MARGIN)
  let contentMaxX = 0, contentMaxY = 0;
  for (const node of nodes) {
    contentMaxX = Math.max(contentMaxX, node.x1);
    contentMaxY = Math.max(contentMaxY, node.y1);
  }

  const LABEL_SPACE = 200; // approximate space for rightmost column labels
  return { nodes, links, ky, maxCol, innerW, innerH, contentW: contentMaxX + NODE_W + LABEL_SPACE, contentH: contentMaxY };
}
