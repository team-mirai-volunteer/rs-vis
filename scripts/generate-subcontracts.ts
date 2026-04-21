/**
 * 再委託構造データ生成スクリプト
 *
 * 5-1・5-2・5-3・2-1 の4CSVから subcontracts-{YEAR}.json を生成する。
 *
 * 使用法:
 *   tsx scripts/generate-subcontracts.ts [YEAR]
 *   例: tsx scripts/generate-subcontracts.ts 2025
 *   デフォルト: 2024
 *
 * 出力: public/data/subcontracts-{YEAR}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from '@/scripts/csv-reader';
import type { SubcontractGraph, SubcontractIndex, BlockNode, BlockEdge, BlockRecipient } from '@/types/subcontract';

const YEAR = parseInt(process.argv[2] || '2024', 10);
if (isNaN(YEAR) || YEAR < 2000 || YEAR > 2100) {
  console.error(`Invalid year: ${process.argv[2]}`);
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, `../data/year_${YEAR}`);
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const OUTPUT_FILE = `subcontracts-${YEAR}.json`;

// ─── 2-1: 予算・執行 ──────────────────────────────────────────────

// sankey-svg と同様: 事業年度=YEAR のファイルから 予算年度=YEAR-1 の行のみ使用
const TARGET_BUDGET_YEAR = YEAR - 1;

console.log(`📖 Reading 2-1 (budget/execution, 予算年度=${TARGET_BUDGET_YEAR})...`);
const csv21 = readShiftJISCSV(path.join(DATA_DIR, `2-1_RS_${YEAR}_予算・執行_サマリ.csv`));

// projectId → { budget, execution, projectName, ministry }
const budgetMap = new Map<number, { budget: number; execution: number; projectName: string; ministry: string }>();
for (const row of csv21) {
  const projectId = parseInt(row['予算事業ID'] ?? '', 10);
  if (isNaN(projectId)) continue;
  // 複数年度が混在するため対象年度のみ抽出
  const fiscalYear = parseInt(row['予算年度'] ?? '', 10);
  if (fiscalYear !== TARGET_BUDGET_YEAR) continue;
  const budget = parseAmount(row['計(歳出予算現額合計)'] ?? '');
  const execution = parseAmount(row['執行額(合計)'] ?? '');
  if (!budgetMap.has(projectId)) {
    budgetMap.set(projectId, {
      budget,
      execution,
      projectName: row['事業名'] ?? '',
      ministry: row['府省庁'] ?? '',
    });
  } else {
    // 同一事業ID・同一予算年度で複数会計がある場合は合算
    const existing = budgetMap.get(projectId)!;
    existing.budget += budget;
    existing.execution += execution;
  }
}
console.log(`  → ${budgetMap.size} projects`);

// ─── 5-2: ブロック間フロー ──────────────────────────────────────────────

console.log('📖 Reading 5-2 (block flows)...');
const csv52 = readShiftJISCSV(path.join(DATA_DIR, `5-2_RS_${YEAR}_支出先_支出ブロックのつながり.csv`));

// projectId → { projectName, ministry, flows: BlockEdge[], directBlocks: Set<string> }
const flowMap = new Map<number, {
  projectName: string;
  ministry: string;
  flows: BlockEdge[];
  directBlocks: Set<string>;
}>();

for (const row of csv52) {
  const projectId = parseInt(row['予算事業ID'] ?? '', 10);
  if (isNaN(projectId)) continue;

  const sourceBlock = (row['支出元の支出先ブロック'] ?? '').trim() || null;
  const targetBlock = (row['支出先の支出先ブロック'] ?? '').trim();
  const isDirect = (row['担当組織からの支出'] ?? '').trim().toUpperCase() === 'TRUE';
  const note = (row['資金の流れの補足情報'] ?? '').trim() || undefined;

  if (!targetBlock) continue;

  if (!flowMap.has(projectId)) {
    flowMap.set(projectId, {
      projectName: row['事業名'] ?? '',
      ministry: row['府省庁'] ?? '',
      flows: [],
      directBlocks: new Set(),
    });
  }

  const entry = flowMap.get(projectId)!;
  entry.flows.push({ sourceBlock, targetBlock, note });
  if (isDirect) entry.directBlocks.add(targetBlock);
}
console.log(`  → ${flowMap.size} projects with flows`);

// ─── 5-1: ブロック内支出先 ──────────────────────────────────────────────

console.log('📖 Reading 5-1 (block recipients)...');
const csv51 = readShiftJISCSV(path.join(DATA_DIR, `5-1_RS_${YEAR}_支出先_支出情報.csv`));

// projectId:blockId → { blockName, totalAmount, recipients: Map<recipientKey, BlockRecipient> }
interface BlockAccum {
  blockName: string;
  totalAmount: number;
  role: string;
  recipients: Map<string, BlockRecipient>;
}
const blockMap = new Map<string, BlockAccum>();

for (const row of csv51) {
  const projectId = parseInt(row['予算事業ID'] ?? '', 10);
  if (isNaN(projectId)) continue;

  const blockId = (row['支出先ブロック番号'] ?? '').trim();
  if (!blockId) continue;

  const key = `${projectId}:${blockId}`;

  // ブロックサマリ行: ブロック名が非空かつ支出先名が空
  const blockName = (row['支出先ブロック名'] ?? '').trim();
  const recipientName = (row['支出先名'] ?? '').trim();
  const totalAmountStr = (row['ブロックの合計支出額'] ?? '').trim();

  if (blockName && !recipientName && totalAmountStr) {
    const role = (row['事業を行う上での役割'] ?? '').trim();
    if (!blockMap.has(key)) {
      blockMap.set(key, { blockName, totalAmount: parseAmount(totalAmountStr), role, recipients: new Map() });
    } else {
      const b = blockMap.get(key)!;
      if (!b.blockName) b.blockName = blockName;
      if (!b.totalAmount) b.totalAmount = parseAmount(totalAmountStr);
      if (!b.role) b.role = role;
    }
    continue;
  }

  if (!recipientName) continue;

  if (!blockMap.has(key)) {
    blockMap.set(key, { blockName: '', totalAmount: 0, role: '', recipients: new Map() });
  }
  const block = blockMap.get(key)!;

  const corporateNumber = (row['法人番号'] ?? '').trim();
  const recipientKey = `${recipientName}|${corporateNumber}`;

  const totalRecipientAmountStr = (row['支出先の合計支出額'] ?? '').trim();
  const contractSummary = (row['契約概要'] ?? '').trim();

  if (!block.recipients.has(recipientKey)) {
    block.recipients.set(recipientKey, {
      name: recipientName,
      corporateNumber,
      amount: 0,
      contractSummaries: [],
      expenses: [],
    });
  }

  const recipient = block.recipients.get(recipientKey)!;

  if (totalRecipientAmountStr) {
    recipient.amount += parseAmount(totalRecipientAmountStr);
  }
  if (contractSummary && !recipient.contractSummaries.includes(contractSummary)) {
    recipient.contractSummaries.push(contractSummary);
  }
}
console.log(`  → ${blockMap.size} blocks`);

// ─── 5-3: 費目・使途 ──────────────────────────────────────────────

console.log('📖 Reading 5-3 (expenses)...');
const csv53 = readShiftJISCSV(path.join(DATA_DIR, `5-3_RS_${YEAR}_支出先_費目・使途.csv`));

for (const row of csv53) {
  const projectId = parseInt(row['予算事業ID'] ?? '', 10);
  if (isNaN(projectId)) continue;

  const blockId = (row['支出先ブロック番号'] ?? '').trim();
  if (!blockId) continue;

  const recipientName = (row['支出先名'] ?? '').trim();
  if (!recipientName) continue;

  const corporateNumber = (row['法人番号'] ?? '').trim();
  const contractSummary53 = (row['契約概要'] ?? '').trim();
  const category = (row['費目'] ?? '').trim();
  const purpose = (row['使途'] ?? '').trim();
  const amountStr = (row['金額'] ?? '').trim();
  if (!category && !purpose && !contractSummary53) continue;

  const blockKey = `${projectId}:${blockId}`;
  const block = blockMap.get(blockKey);
  if (!block) continue;

  const recipientKey = `${recipientName}|${corporateNumber}`;
  const recipient = block.recipients.get(recipientKey);
  if (!recipient) continue;

  if (contractSummary53 && !recipient.contractSummaries.includes(contractSummary53)) {
    recipient.contractSummaries.push(contractSummary53);
  }

  if (!category && !purpose) continue;

  recipient.expenses.push({
    category,
    purpose,
    amount: parseAmount(amountStr),
  });
}

// ─── BFS 深さ計算 ──────────────────────────────────────────────

const MAX_DEPTH_LIMIT = 30; // サイクルや異常データ対策

function computeMaxDepth(flows: BlockEdge[]): number {
  // ルートエッジは sourceBlock === null
  // Fan-In: 同一ブロックに複数親 → 最大深さを採用（サイクルはMAX_DEPTH_LIMITで打ち切り）
  const depthMap = new Map<string, number>();
  const queue: Array<{ blockId: string; depth: number }> = [];

  // adjacency を事前構築して O(n) ルックアップを避ける
  const children = new Map<string, string[]>();
  for (const f of flows) {
    if (f.sourceBlock === null) {
      queue.push({ blockId: f.targetBlock, depth: 1 });
    } else {
      if (!children.has(f.sourceBlock)) children.set(f.sourceBlock, []);
      children.get(f.sourceBlock)!.push(f.targetBlock);
    }
  }

  while (queue.length > 0) {
    const { blockId, depth } = queue.shift()!;
    const existing = depthMap.get(blockId) ?? 0;
    if (depth <= existing || depth > MAX_DEPTH_LIMIT) continue;
    depthMap.set(blockId, depth);
    for (const child of (children.get(blockId) ?? [])) {
      queue.push({ blockId: child, depth: depth + 1 });
    }
  }

  if (depthMap.size === 0) return 1;
  return Math.max(...depthMap.values());
}

// ─── SubcontractGraph 組み立て ──────────────────────────────────────────────

console.log('🔧 Building SubcontractGraph objects...');
const index: SubcontractIndex = {};
let totalProjects = 0;

for (const [projectId, flowEntry] of flowMap) {
  const budgetEntry = budgetMap.get(projectId);
  const allBlockIds = new Set<string>();

  for (const f of flowEntry.flows) {
    if (f.sourceBlock) allBlockIds.add(f.sourceBlock);
    allBlockIds.add(f.targetBlock);
  }

  const blocks: BlockNode[] = [];
  let totalRecipientCount = 0;

  for (const blockId of allBlockIds) {
    const blockKey = `${projectId}:${blockId}`;
    const blockData = blockMap.get(blockKey);

    const recipients = blockData
      ? Array.from(blockData.recipients.values()).sort((a, b) => b.amount - a.amount)
      : [];
    totalRecipientCount += recipients.length;

    blocks.push({
      blockId,
      blockName: blockData?.blockName ?? blockId,
      totalAmount: blockData?.totalAmount ?? 0,
      isDirect: flowEntry.directBlocks.has(blockId),
      role: blockData?.role || undefined,
      recipients,
    });
  }

  // ブロックを totalAmount 降順でソート（レイアウト用）
  blocks.sort((a, b) => b.totalAmount - a.totalAmount);

  const maxDepth = computeMaxDepth(flowEntry.flows);

  const graph: SubcontractGraph = {
    projectId,
    projectName: budgetEntry?.projectName ?? flowEntry.projectName,
    ministry: budgetEntry?.ministry ?? flowEntry.ministry,
    budget: budgetEntry?.budget ?? 0,
    execution: budgetEntry?.execution ?? 0,
    blocks,
    flows: flowEntry.flows,
    maxDepth,
    directBlockCount: flowEntry.directBlocks.size,
    totalBlockCount: allBlockIds.size,
    totalRecipientCount,
  };

  index[String(projectId)] = graph;
  totalProjects++;
}

console.log(`  → ${totalProjects} projects`);

// ─── 出力 ──────────────────────────────────────────────

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
fs.writeFileSync(outputPath, JSON.stringify(index));

const stats = fs.statSync(outputPath);
const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
console.log(`✅ Written: ${outputPath} (${sizeMB} MB, ${totalProjects} projects)`);
