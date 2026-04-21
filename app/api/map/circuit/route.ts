import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface CircuitNode {
  id: string;
  blockKey: string;
  label: string;
  amount: number;
  recipientCount: number;
  isDirect: boolean;
  role: string;
}

export interface CircuitEdge {
  id: string;
  source: string;
  target: string;
  amount: number;
  flowType: string;
}

export interface CircuitData {
  projectId: number;
  projectName: string;
  ministry: string;
  totalBudget: number;
  totalSpending: number;
  nodes: CircuitNode[];
  edges: CircuitEdge[];
  fanInBlocks: string[];
  fanOutBlocks: string[];
}

let cachedStructured: Record<string, unknown> | null = null;
function getStructured(): Record<string, unknown> {
  if (cachedStructured) return cachedStructured;
  const p = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  cachedStructured = JSON.parse(fs.readFileSync(p, 'utf8'));
  return cachedStructured!;
}

export async function GET(request: NextRequest) {
  const pid = parseInt(request.nextUrl.searchParams.get('pid') || '', 10);
  if (isNaN(pid)) {
    return NextResponse.json({ error: 'pid parameter required' }, { status: 400 });
  }

  try {
    const data = getStructured();
    const budgets = data.budgets as Array<{
      projectId: number;
      projectName: string;
      ministry: string;
      totalBudget: number;
      totalSpendingAmount: number;
      spendingIds: number[];
    }>;
    const spendings = data.spendings as Array<{
      spendingId: number;
      spendingName: string;
      projects: Array<{
        projectId: number;
        amount: number;
        blockNumber: string;
        blockName: string;
        contractMethod: string;
        isDirectFromGov: boolean;
        sourceChainPath?: string;
      }>;
      outflows?: Array<{
        projectId: number;
        sourceBlockNumber: string;
        sourceBlockName: string;
        targetBlockNumber: string;
        targetBlockName: string;
        amount: number;
        flowType: string;
      }>;
    }>;

    const budget = budgets.find(b => b.projectId === pid);
    if (!budget) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Collect all blocks and flows for this project
    const blockMap = new Map<string, {
      label: string;
      amount: number;
      recipientCount: number;
      isDirect: boolean;
      role: string;
    }>();
    const edgeList: CircuitEdge[] = [];
    const edgeSeen = new Set<string>();

    // Process spending records linked to this project
    for (const spending of spendings) {
      for (const proj of spending.projects) {
        if (proj.projectId !== pid) continue;
        const blockKey = proj.blockNumber || 'X';

        if (!blockMap.has(blockKey)) {
          blockMap.set(blockKey, {
            label: proj.blockName || blockKey,
            amount: 0,
            recipientCount: 0,
            isDirect: proj.isDirectFromGov,
            role: proj.contractMethod || '',
          });
        }
        const block = blockMap.get(blockKey)!;
        block.amount += proj.amount;
        block.recipientCount += 1;

        // Source chain path → edges
        if (proj.sourceChainPath) {
          // sourceChainPath is like "復興庁 → 内閣府" - trace back
          // The current block is indirect; its parent is encoded in chain
        }
      }

      // Outflows from this spending to subcontractors
      if (spending.outflows) {
        for (const flow of spending.outflows) {
          if (flow.projectId !== pid) continue;
          const edgeId = `${flow.sourceBlockNumber}-${flow.targetBlockNumber}`;
          if (!edgeSeen.has(edgeId)) {
            edgeSeen.add(edgeId);
            edgeList.push({
              id: edgeId,
              source: flow.sourceBlockNumber,
              target: flow.targetBlockNumber,
              amount: flow.amount,
              flowType: flow.flowType || '再委託',
            });

            // Ensure target block exists
            if (!blockMap.has(flow.targetBlockNumber)) {
              blockMap.set(flow.targetBlockNumber, {
                label: flow.targetBlockName,
                amount: flow.amount,
                recipientCount: 0,
                isDirect: false,
                role: flow.flowType || '',
              });
            }
          }
        }
      }
    }

    // Add org node as the root source
    const orgNodeId = 'ORG';
    blockMap.set(orgNodeId, {
      label: budget.ministry,
      amount: budget.totalSpendingAmount || budget.totalBudget,
      recipientCount: 0,
      isDirect: true,
      role: '担当組織',
    });

    // Add edges from org to direct blocks
    for (const [key, block] of blockMap.entries()) {
      if (key === orgNodeId) continue;
      if (block.isDirect) {
        const edgeId = `ORG-${key}`;
        if (!edgeSeen.has(edgeId)) {
          edgeSeen.add(edgeId);
          edgeList.push({
            id: edgeId,
            source: orgNodeId,
            target: key,
            amount: block.amount,
            flowType: '直接支出',
          });
        }
      }
    }

    // Detect fan-in / fan-out
    const inCount = new Map<string, number>();
    const outCount = new Map<string, number>();
    for (const edge of edgeList) {
      inCount.set(edge.target, (inCount.get(edge.target) || 0) + 1);
      outCount.set(edge.source, (outCount.get(edge.source) || 0) + 1);
    }
    const fanInBlocks = [...inCount.entries()].filter(([, c]) => c >= 2).map(([k]) => k);
    const fanOutBlocks = [...outCount.entries()].filter(([, c]) => c >= 2).map(([k]) => k);

    const nodes: CircuitNode[] = [...blockMap.entries()].map(([key, block]) => ({
      id: key,
      blockKey: key,
      label: block.label,
      amount: block.amount,
      recipientCount: block.recipientCount,
      isDirect: block.isDirect,
      role: block.role,
    }));

    const result: CircuitData = {
      projectId: pid,
      projectName: budget.projectName,
      ministry: budget.ministry,
      totalBudget: budget.totalBudget,
      totalSpending: budget.totalSpendingAmount,
      nodes,
      edges: edgeList,
      fanInBlocks,
      fanOutBlocks,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error loading circuit data:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
