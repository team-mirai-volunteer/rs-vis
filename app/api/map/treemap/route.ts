import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface TreemapMinistry {
  name: string;
  totalBudget: number;
  totalSpending: number;
  projectCount: number;
  executionRate: number;
  accountMix: 'general' | 'special' | 'mixed';
  projects: TreemapProject[];
}

// 支出タイプ → 電子部品カテゴリ
// 補助金等交付/交付 → regulator (電力分配)
// 一般競争契約 → processor (競争的・高性能)
// 随意契約 → capacitor (指定・固定)
// 国庫債務負担行為等 → memory (長期債務)
// その他/不明 → resistor (汎用)
export type ChipCategory = 'regulator' | 'processor' | 'capacitor' | 'memory' | 'resistor';

export interface TreemapProject {
  projectId: number;
  name: string;
  budget: number;
  spending: number;
  executionRate: number;
  accountCategory: string;
  bureau: string;
  qualityScore: number | null;
  blockCount: number;
  recipientCount: number;
  chipCategory: ChipCategory;
  hasRedelegation: boolean;
}

let cachedData: TreemapMinistry[] | null = null;

function loadTreemapData(): TreemapMinistry[] {
  if (cachedData) return cachedData;

  const structuredPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  const qualityPath = path.join(process.cwd(), 'public/data/project-quality-scores.json');
  const raw = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));
  const qualityRaw = JSON.parse(fs.readFileSync(qualityPath, 'utf8'));

  // Build quality score lookup by pid
  const qualityByPid = new Map<number, number>();
  const qualityDetailsByPid = new Map<number, { blockCount: number; recipientCount: number; hasRedelegation: boolean }>();
  for (const q of qualityRaw) {
    const pid = parseInt(q.pid, 10);
    if (!isNaN(pid)) {
      qualityByPid.set(pid, q.totalScore ?? null);
      qualityDetailsByPid.set(pid, {
        blockCount: q.blockCount ?? 0,
        recipientCount: q.recipientCount ?? 0,
        hasRedelegation: q.hasRedelegation ?? false,
      });
    }
  }

  // Build budget lookup
  const budgetMap = new Map<number, typeof raw.budgets[0]>();
  for (const b of raw.budgets) {
    budgetMap.set(b.projectId, b);
  }

  // Build dominant contract method per project (by amount)
  const projMethodAmounts = new Map<number, Map<string, number>>();
  for (const spending of raw.spendings) {
    for (const proj of spending.projects) {
      if (!proj.contractMethod) continue;
      const primary = proj.contractMethod.split(',')[0].trim();
      if (!projMethodAmounts.has(proj.projectId)) {
        projMethodAmounts.set(proj.projectId, new Map());
      }
      const m = projMethodAmounts.get(proj.projectId)!;
      m.set(primary, (m.get(primary) || 0) + proj.amount);
    }
  }

  function classifyChip(pid: number): ChipCategory {
    const methods = projMethodAmounts.get(pid);
    if (!methods || methods.size === 0) return 'resistor';
    let dominant = '';
    let maxAmt = 0;
    for (const [method, amt] of methods) {
      if (amt > maxAmt) { dominant = method; maxAmt = amt; }
    }
    if (dominant === '補助金等交付' || dominant === '交付') return 'regulator';
    if (dominant.includes('一般競争') || dominant.includes('指名競争')) return 'processor';
    if (dominant.includes('随意契約')) return 'capacitor';
    if (dominant.includes('国庫債務負担行為')) return 'memory';
    return 'resistor';
  }

  // Build ministry-level data
  const ministryMap = new Map<string, TreemapMinistry>();

  for (const ministry of raw.budgetTree.ministries) {
    // Collect all project IDs recursively
    const projectIds = collectProjectIds(ministry);
    if (projectIds.length === 0) continue;

    const projects: TreemapProject[] = [];
    let totalBudget = 0;
    let totalSpending = 0;
    const accounts = new Set<string>();

    for (const pid of projectIds) {
      const budget = budgetMap.get(pid);
      if (!budget) continue;
      const b = budget.totalBudget || 0;
      const s = budget.totalSpendingAmount || 0;
      totalBudget += b;
      totalSpending += s;
      if (budget.accountCategory) accounts.add(budget.accountCategory);

      const qd = qualityDetailsByPid.get(pid);
      projects.push({
        projectId: pid,
        name: budget.projectName,
        budget: b,
        spending: s,
        executionRate: b > 0 ? s / b : 0,
        accountCategory: budget.accountCategory || '',
        bureau: budget.bureau || '',
        qualityScore: qualityByPid.get(pid) ?? null,
        blockCount: qd?.blockCount ?? 0,
        recipientCount: qd?.recipientCount ?? 0,
        chipCategory: classifyChip(pid),
        hasRedelegation: qd?.hasRedelegation ?? false,
      });
    }

    // Sort by budget descending
    projects.sort((a, b) => b.budget - a.budget);

    let accountMix: 'general' | 'special' | 'mixed' = 'general';
    if (accounts.size > 1) accountMix = 'mixed';
    else if (accounts.has('特別会計')) accountMix = 'special';

    ministryMap.set(ministry.name, {
      name: ministry.name,
      totalBudget,
      totalSpending,
      projectCount: projects.length,
      executionRate: totalBudget > 0 ? totalSpending / totalBudget : 0,
      accountMix,
      projects,
    });
  }

  const result = Array.from(ministryMap.values())
    .sort((a, b) => b.totalBudget - a.totalBudget);

  cachedData = result;
  return result;
}

function collectProjectIds(node: { projectIds?: number[]; bureaus?: unknown[]; departments?: unknown[]; divisions?: unknown[] }): number[] {
  const ids: number[] = [];
  if (node.projectIds) ids.push(...node.projectIds);
  for (const child of (node.bureaus || node.departments || node.divisions || []) as typeof node[]) {
    ids.push(...collectProjectIds(child));
  }
  return ids;
}

export async function GET() {
  try {
    const data = loadTreemapData();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error loading treemap data:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
