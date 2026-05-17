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
import type {
  SubcontractGraph,
  SubcontractIndex,
  BlockNode,
  BlockEdge,
  BlockRecipient,
  IndirectCost,
  BlockOriginKind,
  FlowOrigin,
} from '@/types/subcontract';

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

// projectId → 集計値
interface BudgetEntry {
  budget: number;
  execution: number;
  projectName: string;
  ministry: string;
  bureau: string;
  accountCategorySet: Set<string>;
}
const budgetMap = new Map<number, BudgetEntry>();
const accountCategoryMap = new Map<number, Set<string>>();
for (const row of csv21) {
  const projectId = parseInt(row['予算事業ID'] ?? '', 10);
  if (isNaN(projectId)) continue;
  const accountCategory = (row['会計区分'] ?? '').trim();
  if (accountCategory) {
    let categories = accountCategoryMap.get(projectId);
    if (!categories) {
      categories = new Set<string>();
      accountCategoryMap.set(projectId, categories);
    }
    categories.add(accountCategory);
  }
  // 複数年度が混在するため対象年度のみ抽出
  const fiscalYear = parseInt(row['予算年度'] ?? '', 10);
  if (fiscalYear !== TARGET_BUDGET_YEAR) continue;
  const budget = parseAmount(row['計(歳出予算現額合計)'] ?? '');
  const execution = parseAmount(row['執行額(合計)'] ?? '');
  const bureauParts = ['局・庁', '部', '課', '室']
    .map((k) => (row[k] ?? '').trim())
    .filter(Boolean);
  const bureau = bureauParts.join(' / ');
  if (!budgetMap.has(projectId)) {
    const set = new Set<string>();
    if (accountCategory) set.add(accountCategory);
    budgetMap.set(projectId, {
      budget,
      execution,
      projectName: row['事業名'] ?? '',
      ministry: row['府省庁'] ?? '',
      bureau,
      accountCategorySet: set,
    });
  } else {
    // 同一事業ID・同一予算年度で複数会計がある場合は合算
    const existing = budgetMap.get(projectId)!;
    existing.budget += budget;
    existing.execution += execution;
    if (accountCategory) existing.accountCategorySet.add(accountCategory);
    if (!existing.bureau && bureau) existing.bureau = bureau;
  }
}
console.log(`  → ${budgetMap.size} projects`);

// ─── 5-2: ブロック間フロー ──────────────────────────────────────────────

console.log('📖 Reading 5-2 (block flows)...');
const csv52 = readShiftJISCSV(path.join(DATA_DIR, `5-2_RS_${YEAR}_支出先_支出ブロックのつながり.csv`));

// 内部用フロー一時データ（origin/isReference は集計後に確定）
interface RawFlow {
  sourceBlock: string | null;
  targetBlock: string;
  note?: string;
  isDirectRow: boolean;
  hasTransferNote: boolean;
  hasReferenceNote: boolean;
}

interface FlowEntry {
  projectName: string;
  ministry: string;
  rawFlows: RawFlow[];
  directBlocks: Set<string>;
  indirectCosts: IndirectCost[];
}

const REFERENCE_KEYWORDS = /参考/;
const TRANSFER_KEYWORDS = /移替/;
const INSTITUTIONAL_FLOW_KEYWORDS = /融資|政府保証借入|利子補給/;

const flowMap = new Map<number, FlowEntry>();

for (const row of csv52) {
  const projectId = parseInt(row['予算事業ID'] ?? '', 10);
  if (isNaN(projectId)) continue;

  const sourceBlock = (row['支出元の支出先ブロック'] ?? '').trim() || null;
  const targetBlock = (row['支出先の支出先ブロック'] ?? '').trim();
  const isDirectRow = (row['担当組織からの支出'] ?? '').trim().toUpperCase() === 'TRUE';
  const note = (row['資金の流れの補足情報'] ?? '').trim() || undefined;
  const indirectKindText = (row['国自らが支出する間接経費'] ?? '').trim();
  const indirectCategory = (row['国自らが支出する間接経費の項目'] ?? '').trim();
  const indirectAmountStr = (row['国自らが支出する間接経費の金額'] ?? '').trim();
  // 「国自らが支出する間接経費」列はラベル/分類テキスト（`間接経費` `職員旅費` 等）。
  // 列が空でない、または項目・金額のいずれかがあれば間接経費行として扱う。
  const isIndirectCostRow = !!indirectKindText || (!!indirectCategory && !!indirectAmountStr);

  if (!flowMap.has(projectId)) {
    flowMap.set(projectId, {
      projectName: row['事業名'] ?? '',
      ministry: row['府省庁'] ?? '',
      rawFlows: [],
      directBlocks: new Set(),
      indirectCosts: [],
    });
  }
  const entry = flowMap.get(projectId)!;

  // 国自らが支出する間接経費（targetBlock が空のことがある）は flows から分離
  if (!targetBlock) {
    if (isIndirectCostRow) {
      entry.indirectCosts.push({
        blockHint: (row['支出元の支出先ブロック名'] ?? '').trim() || (row['支出先の支出先ブロック名'] ?? '').trim(),
        kind: indirectKindText,
        category: indirectCategory,
        amount: parseAmount(indirectAmountStr),
        note,
      });
    }
    continue;
  }

  // targetBlock があっても間接経費分類が付いている場合は別配列にも寄せる（フローとしても残す）
  if (isIndirectCostRow) {
    entry.indirectCosts.push({
      blockHint: (row['支出先の支出先ブロック名'] ?? '').trim(),
      kind: indirectKindText,
      category: indirectCategory,
      amount: parseAmount(indirectAmountStr),
      note,
    });
  }

  const hasTransferNote = !!note && TRANSFER_KEYWORDS.test(note);
  const hasReferenceNote = !!note && REFERENCE_KEYWORDS.test(note);

  entry.rawFlows.push({
    sourceBlock,
    targetBlock,
    note,
    isDirectRow,
    hasTransferNote,
    hasReferenceNote,
  });
  if (isDirectRow && !sourceBlock) entry.directBlocks.add(targetBlock);
}
console.log(`  → ${flowMap.size} projects with flows`);

// ─── 5-1: ブロック内支出先 ──────────────────────────────────────────────

console.log('📖 Reading 5-1 (block recipients)...');
const csv51 = readShiftJISCSV(path.join(DATA_DIR, `5-1_RS_${YEAR}_支出先_支出情報.csv`));

// projectId:blockId → BlockAccum
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
    recipient.amount = Math.max(recipient.amount, parseAmount(totalRecipientAmountStr));
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
  const separateOriginRoots = new Set<string>();
  for (const f of flows) {
    if (f.sourceBlock === null) {
      queue.push({ blockId: f.targetBlock, depth: 1 });
    } else {
      if (!children.has(f.sourceBlock)) children.set(f.sourceBlock, []);
      children.get(f.sourceBlock)!.push(f.targetBlock);
      if (f.origin === 'separate-origin') separateOriginRoots.add(f.sourceBlock);
    }
  }
  for (const blockId of separateOriginRoots) {
    queue.push({ blockId, depth: 1 });
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

// ─── 別起点ブロックの構造判定 ──────────────────────────────────────────────

interface OriginAnalysis {
  /** sourceBlock が一度も targetBlock として現れず、direct でもない */
  broadSeparateOriginBlocks: Set<string>;
  /** broad のうち sourceFeedsMerge=true（下流に他支出元と合流するもの） */
  strongSeparateOriginBlocks: Set<string>;
  /** target ごとの流入支出元ブロック数 */
  incomingBlockCountByTarget: Map<string, number>;
  mergeTargetCount: number;
  maxMergeWidth: number;
  branchingBlockCount: number;
  maxBranchWidth: number;
}

function analyzeOrigins(rawFlows: RawFlow[], directBlocks: Set<string>): OriginAnalysis {
  const targetBlocks = new Set<string>();
  const sourceBlocks = new Set<string>();
  const incomingByTarget = new Map<string, Set<string>>();
  const outgoingBySource = new Map<string, Set<string>>();

  for (const f of rawFlows) {
    targetBlocks.add(f.targetBlock);
    if (f.sourceBlock) {
      sourceBlocks.add(f.sourceBlock);
      if (!incomingByTarget.has(f.targetBlock)) incomingByTarget.set(f.targetBlock, new Set());
      incomingByTarget.get(f.targetBlock)!.add(f.sourceBlock);
      if (!outgoingBySource.has(f.sourceBlock)) outgoingBySource.set(f.sourceBlock, new Set());
      outgoingBySource.get(f.sourceBlock)!.add(f.targetBlock);
    }
  }

  const broadSeparateOriginBlocks = new Set<string>();
  for (const sb of sourceBlocks) {
    if (!targetBlocks.has(sb) && !directBlocks.has(sb)) {
      broadSeparateOriginBlocks.add(sb);
    }
  }

  // strong: broad のうち、その下流ブロックの incoming が 2 以上のもの（合流）
  const strongSeparateOriginBlocks = new Set<string>();
  for (const sb of broadSeparateOriginBlocks) {
    const downstreamTargets = rawFlows.filter(f => f.sourceBlock === sb).map(f => f.targetBlock);
    const feedsMerge = downstreamTargets.some(tg => (incomingByTarget.get(tg)?.size ?? 0) >= 2);
    if (feedsMerge) strongSeparateOriginBlocks.add(sb);
  }

  const incomingBlockCountByTarget = new Map<string, number>();
  for (const [tg, srcSet] of incomingByTarget) {
    incomingBlockCountByTarget.set(tg, srcSet.size);
  }

  const mergeWidths = Array.from(incomingByTarget.values(), s => s.size);
  const mergeTargetCount = mergeWidths.filter(w => w >= 2).length;
  const maxMergeWidth = mergeWidths.length > 0 ? Math.max(...mergeWidths) : 0;

  const branchWidths = Array.from(outgoingBySource.values(), s => s.size);
  const branchingBlockCount = branchWidths.filter(w => w >= 2).length;
  const maxBranchWidth = branchWidths.length > 0 ? Math.max(...branchWidths) : 0;

  return {
    broadSeparateOriginBlocks,
    strongSeparateOriginBlocks,
    incomingBlockCountByTarget,
    mergeTargetCount,
    maxMergeWidth,
    branchingBlockCount,
    maxBranchWidth,
  };
}

// ─── SubcontractGraph 組み立て ──────────────────────────────────────────────

console.log('🔧 Building SubcontractGraph objects...');
const index: SubcontractIndex = {};
let totalProjects = 0;

for (const [projectId, flowEntry] of flowMap) {
  const budgetEntry = budgetMap.get(projectId);
  const allBlockIds = new Set<string>();

  for (const f of flowEntry.rawFlows) {
    if (f.sourceBlock) allBlockIds.add(f.sourceBlock);
    allBlockIds.add(f.targetBlock);
  }

  const origins = analyzeOrigins(flowEntry.rawFlows, flowEntry.directBlocks);

  // 下流ブロック (子ブロック) を持つ blockId のセット → terminal 判定用
  const sourceBlocksSet = new Set<string>();
  for (const f of flowEntry.rawFlows) {
    if (f.sourceBlock) sourceBlocksSet.add(f.sourceBlock);
  }

  // ── flows[*] の origin 確定 ──
  const flows: BlockEdge[] = flowEntry.rawFlows.map((rf): BlockEdge => {
    let origin: FlowOrigin;
    if (!rf.sourceBlock && rf.isDirectRow) {
      origin = rf.hasTransferNote ? 'transfer' : 'direct';
    } else if (rf.sourceBlock && origins.broadSeparateOriginBlocks.has(rf.sourceBlock)) {
      origin = 'separate-origin';
    } else {
      origin = 'subcontract';
    }
    const targetIncomingBlockCount = origins.incomingBlockCountByTarget.get(rf.targetBlock) ?? 0;
    return {
      sourceBlock: rf.sourceBlock,
      targetBlock: rf.targetBlock,
      note: rf.note,
      origin,
      isReference: rf.hasReferenceNote,
      targetIncomingBlockCount,
    };
  });

  // ── ブロック組み立て ──
  let totalRecipientCount = 0;
  const blocks: BlockNode[] = [];

  for (const blockId of allBlockIds) {
    const blockKey = `${projectId}:${blockId}`;
    const blockData = blockMap.get(blockKey);

    const recipientsArr = blockData
      ? Array.from(blockData.recipients.values()).sort((a, b) => b.amount - a.amount)
      : [];
    totalRecipientCount += recipientsArr.length;

    const isDirect = flowEntry.directBlocks.has(blockId);
    let originKind: BlockOriginKind;
    if (origins.strongSeparateOriginBlocks.has(blockId)) {
      originKind = 'separate-origin-strong';
    } else if (origins.broadSeparateOriginBlocks.has(blockId)) {
      originKind = 'separate-origin-broad';
    } else if (isDirect) {
      originKind = 'direct';
    } else {
      originKind = 'subcontract';
    }

    const isTerminal = !sourceBlocksSet.has(blockId);
    const hasExpenses = recipientsArr.some(r => r.expenses.length > 0);

    blocks.push({
      blockId,
      blockName: blockData?.blockName ?? blockId,
      totalAmount: blockData?.totalAmount ?? 0,
      isDirect,
      originKind,
      isTerminal,
      recipientCount: recipientsArr.length,
      hasExpenses,
      role: blockData?.role || undefined,
      recipients: recipientsArr,
    });
  }

  // ブロックを totalAmount 降順でソート（レイアウト用）
  blocks.sort((a, b) => b.totalAmount - a.totalAmount);

  // 5-1 ブロックの集計
  const directExpenseTotal = blocks
    .filter((b) => b.originKind === 'direct')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const totalExpense = blocks.reduce((sum, b) => sum + b.totalAmount, 0);

  // ── 参考フロー判定: subcontract で下流ブロック金額0 + 制度キーワード → reference ──
  const blockAmountById = new Map(blocks.map(b => [b.blockId, b.totalAmount]));
  for (const flow of flows) {
    if (flow.origin !== 'subcontract') continue;
    const targetAmount = blockAmountById.get(flow.targetBlock) ?? 0;
    if (targetAmount > 0) continue;
    if (flow.note && INSTITUTIONAL_FLOW_KEYWORDS.test(flow.note)) {
      flow.origin = 'reference';
    }
  }

  // ── 集計フィールド ──
  const separateOriginCount = origins.broadSeparateOriginBlocks.size;
  const strongSeparateOriginCount = origins.strongSeparateOriginBlocks.size;
  const separateOriginAmount = blocks
    .filter(b => b.originKind === 'separate-origin-broad' || b.originKind === 'separate-origin-strong')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const hasReferenceFlow = flows.some(f => f.origin === 'reference' || f.isReference);
  const isInstitutionalFlowOnly = blocks.length > 0
    && blocks.every(b => b.totalAmount === 0 && b.recipients.length === 0);

  const maxDepth = computeMaxDepth(flows);

  // 会計区分の文字列化（一般会計+特別会計 / 一般会計 / 特別会計 / 空）
  let accountCategory = '';
  const accountCategorySet = accountCategoryMap.get(projectId) ?? budgetEntry?.accountCategorySet;
  if (accountCategorySet) {
    const cats = Array.from(accountCategorySet).sort();
    accountCategory = cats.join('+');
  }

  const graph: SubcontractGraph = {
    projectId,
    projectName: budgetEntry?.projectName ?? flowEntry.projectName,
    ministry: budgetEntry?.ministry ?? flowEntry.ministry,
    bureau: budgetEntry?.bureau ?? '',
    accountCategory,
    budget: budgetEntry?.budget ?? 0,
    execution: budgetEntry?.execution ?? 0,
    directExpenseTotal,
    totalExpense,
    blocks,
    flows,
    maxDepth,
    directBlockCount: flowEntry.directBlocks.size,
    totalBlockCount: allBlockIds.size,
    totalRecipientCount,
    indirectCosts: flowEntry.indirectCosts,
    hasSeparateOrigin: separateOriginCount > 0,
    separateOriginCount,
    strongSeparateOriginCount,
    separateOriginAmount,
    hasMerge: origins.mergeTargetCount > 0,
    mergeTargetCount: origins.mergeTargetCount,
    maxMergeWidth: origins.maxMergeWidth,
    branchingBlockCount: origins.branchingBlockCount,
    maxBranchWidth: origins.maxBranchWidth,
    hasReferenceFlow,
    isInstitutionalFlowOnly,
  };

  index[String(projectId)] = graph;
  totalProjects++;
}

console.log(`  → ${totalProjects} projects`);

// ─── 集計サマリ ──────────────────────────────────────────────

const projectsWithSeparateOrigin = Object.values(index).filter(g => g.hasSeparateOrigin).length;
const projectsWithStrongSeparateOrigin = Object.values(index).filter(g => g.strongSeparateOriginCount > 0).length;
const projectsInstitutionalOnly = Object.values(index).filter(g => g.isInstitutionalFlowOnly).length;
const projectsWithMerge = Object.values(index).filter(g => g.hasMerge).length;
const projectsWithIndirectCosts = Object.values(index).filter(g => g.indirectCosts.length > 0).length;
console.log(`  別起点あり(広め): ${projectsWithSeparateOrigin} 事業`);
console.log(`  別起点あり(強い): ${projectsWithStrongSeparateOrigin} 事業`);
console.log(`  合流あり        : ${projectsWithMerge} 事業`);
console.log(`  制度フローのみ  : ${projectsInstitutionalOnly} 事業`);
console.log(`  間接経費あり    : ${projectsWithIndirectCosts} 事業`);

// ─── 出力 ──────────────────────────────────────────────

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
fs.writeFileSync(outputPath, JSON.stringify(index));

const stats = fs.statSync(outputPath);
const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
console.log(`✅ Written: ${outputPath} (${sizeMB} MB, ${totalProjects} projects)`);
