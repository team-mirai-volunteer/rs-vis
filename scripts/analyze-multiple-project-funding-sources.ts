/**
 * 事業単位の複数支出元/別起点ブロックを 5-1 / 5-2 CSV から検知する。
 *
 * Usage:
 *   npx tsx scripts/analyze-multiple-project-funding-sources.ts 2025
 *
 * Output:
 *   data/result/multiple_project_funding_sources_<YEAR>.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';
import type { CSVRow } from '@/types/rs-system';

const YEAR = parseInt(process.argv[2] || '2025', 10);
if (isNaN(YEAR) || YEAR < 2000 || YEAR > 2100) {
  console.error(`Invalid year: ${process.argv[2]}`);
  process.exit(1);
}

const DATA_DIR = path.join(process.cwd(), 'data', `year_${YEAR}`);
const RESULT_DIR = path.join(process.cwd(), 'data', 'result');
const OUTPUT_PATH = path.join(RESULT_DIR, `multiple_project_funding_sources_${YEAR}.csv`);

const trim = (value: unknown): string => String(value ?? '').trim();
const isTrue = (value: unknown): boolean => trim(value).toUpperCase() === 'TRUE';
const blockKey = (pid: string, block: string): string => `${pid}:${block}`;

interface BlockSummary {
  projectId: string;
  projectName: string;
  ministry: string;
  blockId: string;
  blockName: string;
  role: string;
  blockAmount: number;
  recipientCountText: string;
}

interface RecipientSummary {
  amount: number;
  names: Set<string>;
  otherFlags: Set<string>;
  seenRecipients: Set<string>;
}

interface FundingSourceCandidate {
  year: number;
  projectId: string;
  projectName: string;
  ministry: string;
  projectMaxDepth: number;
  projectTotalBlockCount: number;
  projectDirectBlockCount: number;
  projectTotalRecipientCount: number;
  projectBranchingBlockCount: number;
  projectMaxBranchWidth: number;
  projectMergingBlockCount: number;
  projectMaxMergeWidth: number;
  sourceKind: 'explicit-ministry-root' | 'separate-origin';
  sourceBlock: string;
  sourceName: string;
  sourceOutgoingBlockCount: number;
  sourceIncomingBlockCount: number;
  sourceFeedsMerge: boolean;
  sourceMaxTargetIncomingBlockCount: number;
  role: string;
  blockAmount: number;
  recipientAmount: number;
  recipientNames: string[];
  targetBlocks: string[];
  targetNames: string[];
  notes: string[];
  category: string;
  isLikelyFundingSource: boolean;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function classifySource(text: string): { category: string; isLikelyFundingSource: boolean } {
  const checks: Array<[RegExp, string]> = [
    [/財政|財投|融資資金|借入|政府保証/, '借入・財投・保証'],
    [/回収金|償還/, '回収・償還'],
    [/自己収入|収入等|受講料収入|手数料収入|その他収入/, '自己収入・その他収入'],
    [/負担金|利水者/, '負担金'],
    [/移替/, '移替'],
    [/繰入|交付金債務/, '繰入・債務'],
  ];
  for (const [re, category] of checks) {
    if (re.test(text)) return { category, isLikelyFundingSource: true };
  }
  return { category: '経由主体・実施主体など', isLikelyFundingSource: false };
}

function buildBlockSummaries(rows51: CSVRow[]): Map<string, BlockSummary> {
  const summaries = new Map<string, BlockSummary>();
  for (const row of rows51) {
    const projectId = trim(row['予算事業ID']);
    const blockId = trim(row['支出先ブロック番号']);
    const blockName = trim(row['支出先ブロック名']);
    const recipientName = trim(row['支出先名']);
    if (!projectId || !blockId || !blockName || recipientName) continue;

    summaries.set(blockKey(projectId, blockId), {
      projectId,
      projectName: trim(row['事業名']),
      ministry: trim(row['府省庁']),
      blockId,
      blockName,
      role: trim(row['事業を行う上での役割']),
      blockAmount: parseAmount(trim(row['ブロックの合計支出額'])),
      recipientCountText: trim(row['支出先の数']),
    });
  }
  return summaries;
}

function buildRecipientSummaries(rows51: CSVRow[]): Map<string, RecipientSummary> {
  const recipients = new Map<string, RecipientSummary>();
  for (const row of rows51) {
    const projectId = trim(row['予算事業ID']);
    const blockId = trim(row['支出先ブロック番号']);
    const recipientName = trim(row['支出先名']);
    const amountText = trim(row['支出先の合計支出額']);
    if (!projectId || !blockId || !recipientName || !amountText) continue;

    const key = blockKey(projectId, blockId);
    let entry = recipients.get(key);
    if (!entry) {
      entry = { amount: 0, names: new Set(), otherFlags: new Set(), seenRecipients: new Set() };
      recipients.set(key, entry);
    }
    const recipientKey = `${recipientName}|${trim(row['法人番号'])}`;
    if (!entry.seenRecipients.has(recipientKey)) {
      entry.amount += parseAmount(amountText);
      entry.seenRecipients.add(recipientKey);
    }
    entry.names.add(recipientName);
    entry.otherFlags.add(trim(row['その他支出先']));
  }
  return recipients;
}

function buildProjectStats(rows51: CSVRow[], rows52: CSVRow[]): Map<string, {
  maxDepth: number;
  totalBlockCount: number;
  directBlockCount: number;
  totalRecipientCount: number;
  branchingBlockCount: number;
  maxBranchWidth: number;
  mergingBlockCount: number;
  maxMergeWidth: number;
}> {
  const blockIdsByProject = new Map<string, Set<string>>();
  const directBlockIdsByProject = new Map<string, Set<string>>();
  const recipientKeysByProject = new Map<string, Set<string>>();
  const childrenByProject = new Map<string, Map<string, Set<string>>>();
  const parentsByProject = new Map<string, Map<string, Set<string>>>();
  const rootsByProject = new Map<string, Set<string>>();

  for (const row of rows52) {
    const projectId = trim(row['予算事業ID']);
    const sourceBlock = trim(row['支出元の支出先ブロック']);
    const targetBlock = trim(row['支出先の支出先ブロック']);
    if (!projectId || !targetBlock) continue;

    if (!blockIdsByProject.has(projectId)) blockIdsByProject.set(projectId, new Set());
    blockIdsByProject.get(projectId)!.add(targetBlock);
    if (sourceBlock) blockIdsByProject.get(projectId)!.add(sourceBlock);

    if (!childrenByProject.has(projectId)) childrenByProject.set(projectId, new Map());
    if (sourceBlock) {
      const children = childrenByProject.get(projectId)!;
      if (!children.has(sourceBlock)) children.set(sourceBlock, new Set());
      children.get(sourceBlock)!.add(targetBlock);

      if (!parentsByProject.has(projectId)) parentsByProject.set(projectId, new Map());
      const parents = parentsByProject.get(projectId)!;
      if (!parents.has(targetBlock)) parents.set(targetBlock, new Set());
      parents.get(targetBlock)!.add(sourceBlock);
    }

    if (!sourceBlock && isTrue(row['担当組織からの支出'])) {
      if (!directBlockIdsByProject.has(projectId)) directBlockIdsByProject.set(projectId, new Set());
      directBlockIdsByProject.get(projectId)!.add(targetBlock);
      if (!rootsByProject.has(projectId)) rootsByProject.set(projectId, new Set());
      rootsByProject.get(projectId)!.add(targetBlock);
    }
  }

  for (const row of rows51) {
    const projectId = trim(row['予算事業ID']);
    const blockId = trim(row['支出先ブロック番号']);
    const recipientName = trim(row['支出先名']);
    const corporateNumber = trim(row['法人番号']);
    if (!projectId || !blockId) continue;
    if (!blockIdsByProject.has(projectId)) blockIdsByProject.set(projectId, new Set());
    blockIdsByProject.get(projectId)!.add(blockId);
    if (recipientName) {
      if (!recipientKeysByProject.has(projectId)) recipientKeysByProject.set(projectId, new Set());
      recipientKeysByProject.get(projectId)!.add(`${blockId}:${recipientName}:${corporateNumber}`);
    }
  }

  const stats = new Map<string, {
    maxDepth: number;
    totalBlockCount: number;
    directBlockCount: number;
    totalRecipientCount: number;
    branchingBlockCount: number;
    maxBranchWidth: number;
    mergingBlockCount: number;
    maxMergeWidth: number;
  }>();

  for (const [projectId, blockIds] of blockIdsByProject) {
    const roots = rootsByProject.get(projectId) ?? new Set<string>();
    const children = childrenByProject.get(projectId) ?? new Map<string, Set<string>>();
    const parents = parentsByProject.get(projectId) ?? new Map<string, Set<string>>();
    const branchWidths = Array.from(children.values(), targets => targets.size);
    const mergeWidths = Array.from(parents.values(), sources => sources.size);
    const depthByBlock = new Map<string, number>();
    const queue = Array.from(roots, blockId => ({ blockId, depth: 1 }));
    while (queue.length > 0) {
      const current = queue.shift()!;
      const existing = depthByBlock.get(current.blockId) ?? 0;
      if (current.depth <= existing || current.depth > 30) continue;
      depthByBlock.set(current.blockId, current.depth);
      for (const child of children.get(current.blockId) ?? []) {
        queue.push({ blockId: child, depth: current.depth + 1 });
      }
    }

    stats.set(projectId, {
      maxDepth: depthByBlock.size > 0 ? Math.max(...depthByBlock.values()) : 0,
      totalBlockCount: blockIds.size,
      directBlockCount: directBlockIdsByProject.get(projectId)?.size ?? 0,
      totalRecipientCount: recipientKeysByProject.get(projectId)?.size ?? 0,
      branchingBlockCount: branchWidths.filter(width => width >= 2).length,
      maxBranchWidth: branchWidths.length > 0 ? Math.max(...branchWidths) : 0,
      mergingBlockCount: mergeWidths.filter(width => width >= 2).length,
      maxMergeWidth: mergeWidths.length > 0 ? Math.max(...mergeWidths) : 0,
    });
  }

  return stats;
}

function analyze(): FundingSourceCandidate[] {
  const rows51 = readShiftJISCSV(path.join(DATA_DIR, `5-1_RS_${YEAR}_支出先_支出情報.csv`));
  const rows52 = readShiftJISCSV(path.join(DATA_DIR, `5-2_RS_${YEAR}_支出先_支出ブロックのつながり.csv`));

  const blockSummaries = buildBlockSummaries(rows51);
  const recipientSummaries = buildRecipientSummaries(rows51);
  const projectStats = buildProjectStats(rows51, rows52);

  const rowsByProject = new Map<string, CSVRow[]>();
  for (const row of rows52) {
    const projectId = trim(row['予算事業ID']);
    const targetBlock = trim(row['支出先の支出先ブロック']);
    if (!projectId || !targetBlock) continue;
    if (!rowsByProject.has(projectId)) rowsByProject.set(projectId, []);
    rowsByProject.get(projectId)!.push(row);
  }

  const candidates: FundingSourceCandidate[] = [];

  for (const [projectId, rows] of rowsByProject) {
    const targetBlocks = new Set(rows.map(row => trim(row['支出先の支出先ブロック'])).filter(Boolean));
    const directTargetBlocks = new Set(
      rows
        .filter(row => !trim(row['支出元の支出先ブロック']) && isTrue(row['担当組織からの支出']))
        .map(row => trim(row['支出先の支出先ブロック']))
        .filter(Boolean),
    );
    const sourceBlocks = new Set(rows.map(row => trim(row['支出元の支出先ブロック'])).filter(Boolean));
    const incomingBlocksByTarget = new Map<string, Set<string>>();
    for (const row of rows) {
      const sourceBlock = trim(row['支出元の支出先ブロック']);
      const targetBlock = trim(row['支出先の支出先ブロック']);
      if (!sourceBlock || !targetBlock) continue;
      if (!incomingBlocksByTarget.has(targetBlock)) incomingBlocksByTarget.set(targetBlock, new Set());
      incomingBlocksByTarget.get(targetBlock)!.add(sourceBlock);
    }

    for (const sourceBlock of sourceBlocks) {
      const isSeparateOrigin = !targetBlocks.has(sourceBlock) && !directTargetBlocks.has(sourceBlock);
      if (!isSeparateOrigin) continue;

      const key = blockKey(projectId, sourceBlock);
      const block = blockSummaries.get(key);
      const recipient = recipientSummaries.get(key);
      if (!block || !recipient || recipient.amount <= 0) continue;

      const outgoingRows = rows.filter(row => trim(row['支出元の支出先ブロック']) === sourceBlock);
      const targetIds = Array.from(new Set(outgoingRows.map(row => trim(row['支出先の支出先ブロック'])).filter(Boolean)));
      const incomingIds = Array.from(incomingBlocksByTarget.get(sourceBlock) ?? []);
      const targetIncomingWidths = targetIds.map(targetId => incomingBlocksByTarget.get(targetId)?.size ?? 0);
      const targetNames = Array.from(new Set(outgoingRows.map(row => trim(row['支出先の支出先ブロック名'])).filter(Boolean)));
      const notes = Array.from(new Set(outgoingRows.map(row => trim(row['資金の流れの補足情報'])).filter(Boolean)));
      const recipientNames = Array.from(recipient.names);
      const textForClassify = [
        block.blockName,
        block.role,
        recipientNames.join(' '),
        targetNames.join(' '),
        notes.join(' '),
      ].join(' ');
      const { category, isLikelyFundingSource } = classifySource(textForClassify);

      candidates.push({
        year: YEAR,
        projectId,
        projectName: block.projectName,
        ministry: block.ministry,
        projectMaxDepth: projectStats.get(projectId)?.maxDepth ?? 0,
        projectTotalBlockCount: projectStats.get(projectId)?.totalBlockCount ?? 0,
        projectDirectBlockCount: projectStats.get(projectId)?.directBlockCount ?? 0,
        projectTotalRecipientCount: projectStats.get(projectId)?.totalRecipientCount ?? 0,
        projectBranchingBlockCount: projectStats.get(projectId)?.branchingBlockCount ?? 0,
        projectMaxBranchWidth: projectStats.get(projectId)?.maxBranchWidth ?? 0,
        projectMergingBlockCount: projectStats.get(projectId)?.mergingBlockCount ?? 0,
        projectMaxMergeWidth: projectStats.get(projectId)?.maxMergeWidth ?? 0,
        sourceKind: 'separate-origin',
        sourceBlock,
        sourceName: block.blockName,
        sourceOutgoingBlockCount: targetIds.length,
        sourceIncomingBlockCount: incomingIds.length,
        sourceFeedsMerge: targetIncomingWidths.some(width => width >= 2),
        sourceMaxTargetIncomingBlockCount: targetIncomingWidths.length > 0 ? Math.max(...targetIncomingWidths) : 0,
        role: block.role,
        blockAmount: block.blockAmount,
        recipientAmount: recipient.amount,
        recipientNames,
        targetBlocks: targetIds,
        targetNames,
        notes,
        category,
        isLikelyFundingSource,
      });
    }
  }

  return candidates.sort((a, b) => b.recipientAmount - a.recipientAmount);
}

function writeCsv(rows: FundingSourceCandidate[]): void {
  if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });
  const headers = [
    'year',
    'projectId',
    'projectName',
    'ministry',
    'projectMaxDepth',
    'projectTotalBlockCount',
    'projectDirectBlockCount',
    'projectTotalRecipientCount',
    'projectBranchingBlockCount',
    'projectMaxBranchWidth',
    'projectMergingBlockCount',
    'projectMaxMergeWidth',
    'sourceKind',
    'sourceBlock',
    'sourceName',
    'sourceOutgoingBlockCount',
    'sourceIncomingBlockCount',
    'sourceFeedsMerge',
    'sourceMaxTargetIncomingBlockCount',
    'category',
    'isLikelyFundingSource',
    'role',
    'blockAmount',
    'recipientAmount',
    'recipientNames',
    'targetBlocks',
    'targetNames',
    'notes',
  ];
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(header => {
      const value = row[header as keyof FundingSourceCandidate];
      return csvEscape(Array.isArray(value) ? value.join(' / ') : value);
    }).join(',')),
  ];
  fs.writeFileSync(OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf-8');
}

const rows = analyze();
writeCsv(rows);

const likely = rows.filter(row => row.isLikelyFundingSource);
const feedsMerge = rows.filter(row => row.sourceFeedsMerge);
const totalAmount = rows.reduce((sum, row) => sum + row.recipientAmount, 0);
const likelyAmount = likely.reduce((sum, row) => sum + row.recipientAmount, 0);
const feedsMergeAmount = feedsMerge.reduce((sum, row) => sum + row.recipientAmount, 0);

console.log(`複数支出元/別起点候補: ${new Set(rows.map(row => row.projectId)).size}事業 / ${rows.length}ブロック / ${totalAmount.toLocaleString()}円`);
console.log(`合流支出元でもある候補: ${new Set(feedsMerge.map(row => row.projectId)).size}事業 / ${feedsMerge.length}ブロック / ${feedsMergeAmount.toLocaleString()}円`);
console.log(`財源・収入・借入・回収・移替系: ${new Set(likely.map(row => row.projectId)).size}事業 / ${likely.length}ブロック / ${likelyAmount.toLocaleString()}円`);
console.log(`出力: ${OUTPUT_PATH}`);
console.log('\nTop candidates:');
for (const row of rows.slice(0, 20)) {
  console.log([
    row.projectId,
    row.projectName,
    row.sourceBlock,
    row.sourceName,
    row.category,
    `${row.recipientAmount.toLocaleString()}円`,
    `depth=${row.projectMaxDepth}`,
    `blocks=${row.projectTotalBlockCount}`,
    `recipients=${row.projectTotalRecipientCount}`,
    `branchingBlocks=${row.projectBranchingBlockCount}`,
    `maxBranch=${row.projectMaxBranchWidth}`,
    `mergingBlocks=${row.projectMergingBlockCount}`,
    `maxMerge=${row.projectMaxMergeWidth}`,
    `sourceOutgoing=${row.sourceOutgoingBlockCount}`,
    `sourceIncoming=${row.sourceIncomingBlockCount}`,
    `feedsMerge=${row.sourceFeedsMerge}`,
    `targetIncomingMax=${row.sourceMaxTargetIncomingBlockCount}`,
    `to=${row.targetNames.join(' / ')}`,
  ].join('\t'));
}
