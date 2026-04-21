/**
 * /sankey-svg 用グラフデータ生成スクリプト
 *
 * 5-1 CSV（支出情報）+ 5-2 CSV（ブロックのつながり）から、
 * 直接支出先のみのサンキー図用データを生成する。
 *
 * 直接支出の判定: 5-2 CSVの「担当組織からの支出=TRUE」
 *
 * 使用法:
 *   tsx scripts/generate-sankey-svg-data.ts [YEAR]
 *   例: tsx scripts/generate-sankey-svg-data.ts 2025
 *   デフォルト: 2024
 *
 * 出力: public/data/sankey-svg-{YEAR}-graph.json
 *
 * 使用CSV:
 *   1-1: 組織情報（府省庁階層）
 *   2-1: 予算・執行サマリ（事業別予算額・執行額）
 *   5-1: 支出先・支出情報（支出先名・金額）
 *   5-2: 支出先・支出ブロックのつながり（直接支出判定用）
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from '@/scripts/csv-reader';
import type { CSVRow } from '@/types/rs-system';

// ─── 年度設定 ──────────────────────────────────────────────
const YEAR = parseInt(process.argv[2] || '2024', 10);
if (isNaN(YEAR) || YEAR < 2000 || YEAR > 2100) {
  console.error(`Invalid year: ${process.argv[2]}`);
  process.exit(1);
}

// ─── 定数 ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, `../data/year_${YEAR}`);
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const OUTPUT_FILE = `sankey-svg-${YEAR}-graph.json`;
const TARGET_BUDGET_YEAR = YEAR - 1; // 例: 2025年度事業 → 2024年度予算データを使用

// ─── 型定義 ──────────────────────────────────────────────

type NodeType = 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';

interface SankeyNode {
  id: string;
  name: string;
  type: NodeType;
  value: number;       // 1円単位
  aggregated?: boolean; // TopN以外の集約ノード（クライアント側で付与）
  projectId?: number;   // project-budget/project-spending のみ
  ministry?: string;    // ministry / project のみ
}

interface SankeyEdge {
  source: string;
  target: string;
  value: number;        // 1円単位
}

interface SankeyGraphData {
  metadata: {
    generatedAt: string;
    year: number;
    totalBudget: number;
    totalSpending: number;
    directSpending: number;
    indirectSpending: number;
    ministryCount: number;
    projectCount: number;
    recipientCount: number;
    edgeCount: number;
  };
  nodes: SankeyNode[];
  edges: SankeyEdge[];
}

// ─── CSV読み込み ──────────────────────────────────────────

function loadCSV(filename: string): CSVRow[] {
  const filePath = path.join(DATA_DIR, filename);
  console.log(`  読み込み中: ${filename}`);
  const rows = readShiftJISCSV(filePath);
  console.log(`    → ${rows.length.toLocaleString()} 行`);
  return rows;
}

// ─── メイン処理 ──────────────────────────────────────────

function main() {
  console.log(`=== sankey-svg グラフデータ生成 (${YEAR}年度) ===\n`);
  console.log(`  データディレクトリ: ${DATA_DIR}`);
  console.log(`  出力ファイル: ${OUTPUT_FILE}`);
  console.log(`  予算年度フィルタ: ${TARGET_BUDGET_YEAR}\n`);

  // 1. CSV読み込み
  console.log('[1/5] CSV読み込み');
  const orgRows = loadCSV(`1-1_RS_${YEAR}_基本情報_組織情報.csv`);
  const budgetRows = loadCSV(`2-1_RS_${YEAR}_予算・執行_サマリ.csv`);
  const spendingRows = loadCSV(`5-1_RS_${YEAR}_支出先_支出情報.csv`);
  const blockRows = loadCSV(`5-2_RS_${YEAR}_支出先_支出ブロックのつながり.csv`);

  // 2. 組織情報マップ（予算事業ID → 府省庁名・事業名）
  console.log('\n[2/5] 組織・予算データ構築');
  const orgMap = new Map<number, { ministry: string; projectName: string }>();
  for (const row of orgRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    orgMap.set(pid, {
      ministry: row['府省庁'] || row['所管府省庁'] || '',
      projectName: row['事業名'] || '',
    });
  }
  console.log(`  組織情報: ${orgMap.size.toLocaleString()} 事業`);

  // 3. 予算データ集計（予算年度=TARGET_BUDGET_YEAR のみ）
  const budgetMap = new Map<number, { totalBudget: number; executedAmount: number }>();
  for (const row of budgetRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    const fiscalYear = parseInt(row['予算年度'], 10);
    if (fiscalYear !== TARGET_BUDGET_YEAR) continue;
    if (!orgMap.has(pid)) continue;

    const existing = budgetMap.get(pid) || { totalBudget: 0, executedAmount: 0 };
    existing.totalBudget += parseAmount(row['計(歳出予算現額合計)']);
    existing.executedAmount += parseAmount(row['執行額(合計)']);
    budgetMap.set(pid, existing);
  }
  console.log(`  予算データ: ${budgetMap.size.toLocaleString()} 事業`);

  // 4. 直接支出ブロックセットの構築（5-2 CSV）
  console.log('\n[3/5] 直接支出ブロック判定（5-2 CSV）');
  const directBlocks = new Set<string>(); // "pid:block" 形式
  let totalBlockRows = 0;
  let directBlockRows = 0;
  for (const row of blockRows) {
    totalBlockRows++;
    const isDirect = row['担当組織からの支出'] === 'TRUE';
    if (!isDirect) continue;

    const pid = row['予算事業ID'];
    const block = (row['支出先の支出先ブロック'] || '').trim();
    if (!pid || !block) continue;

    directBlocks.add(`${pid}:${block}`);
    directBlockRows++;
  }
  console.log(`  5-2 CSV: ${totalBlockRows.toLocaleString()} 行`);
  console.log(`  直接支出ブロック: ${directBlocks.size.toLocaleString()} ペア（${directBlockRows.toLocaleString()} 行）`);

  // 5. 支出データ集計（直接支出先のみ）
  console.log('\n[4/5] 支出データ集計（直接支出先のみ）');

  interface RecipientAgg {
    name: string;
    totalAmount: number;
    projectAmounts: Map<number, number>; // projectId → amount
  }
  const recipientMap = new Map<string, RecipientAgg>();
  const projectSpendingMap = new Map<number, number>(); // 事業ごとの直接支出合計

  let totalSpendingRows = 0;
  let directRows = 0;
  let indirectRows = 0;
  let skippedNoName = 0;
  let skippedNoAmount = 0;
  let skippedNoBlock = 0;
  let directTotalAmount = 0;
  let indirectTotalAmount = 0;

  for (const row of spendingRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    if (!orgMap.has(pid)) continue;

    const spendingName = (row['支出先名'] || '').trim();
    if (!spendingName) { skippedNoName++; continue; }

    const amount = parseAmount(row['金額']);
    if (amount <= 0) { skippedNoAmount++; continue; }

    totalSpendingRows++;

    const block = (row['支出先ブロック番号'] || '').trim();
    if (!block) { skippedNoBlock++; continue; }

    // 直接支出ブロック判定
    const key = `${pid}:${block}`;
    if (!directBlocks.has(key)) {
      indirectRows++;
      indirectTotalAmount += amount;
      continue;
    }

    // 直接支出先として集計
    directRows++;
    directTotalAmount += amount;

    const recipientKey = spendingName;
    let recipient = recipientMap.get(recipientKey);
    if (!recipient) {
      recipient = { name: spendingName, totalAmount: 0, projectAmounts: new Map() };
      recipientMap.set(recipientKey, recipient);
    }
    recipient.totalAmount += amount;
    recipient.projectAmounts.set(pid, (recipient.projectAmounts.get(pid) || 0) + amount);

    projectSpendingMap.set(pid, (projectSpendingMap.get(pid) || 0) + amount);
  }

  console.log(`  全支出行: ${totalSpendingRows.toLocaleString()}`);
  console.log(`  直接支出: ${directRows.toLocaleString()} 行 / ${(directTotalAmount / 1e12).toFixed(2)} 兆円`);
  console.log(`  間接支出: ${indirectRows.toLocaleString()} 行 / ${(indirectTotalAmount / 1e12).toFixed(2)} 兆円`);
  console.log(`  スキップ: 名前なし=${skippedNoName.toLocaleString()}, 金額0=${skippedNoAmount.toLocaleString()}, ブロック空=${skippedNoBlock.toLocaleString()}`);
  console.log(`  直接支出先ユニーク数: ${recipientMap.size.toLocaleString()}`);

  // 6. グラフ構築
  console.log('\n[5/5] グラフ構築');
  const nodes: SankeyNode[] = [];
  const edges: SankeyEdge[] = [];

  // 6a. 全体ノード
  let totalBudget = 0;
  for (const [, b] of budgetMap) totalBudget += b.totalBudget;

  nodes.push({
    id: 'total',
    name: '予算総計',
    type: 'total',
    value: totalBudget,
  });

  // 6b. 府省庁ノード
  const ministryBudgets = new Map<string, number>();
  for (const [pid, org] of orgMap) {
    const budget = budgetMap.get(pid);
    if (budget) {
      ministryBudgets.set(org.ministry, (ministryBudgets.get(org.ministry) || 0) + budget.totalBudget);
    }
  }

  for (const [ministry, budget] of ministryBudgets) {
    if (!ministry || !ministry.trim()) {
      console.warn('  !! 空の省庁名を検出、スキップします');
      continue;
    }
    const ministryId = `ministry-${ministry}`;
    nodes.push({
      id: ministryId,
      name: ministry,
      type: 'ministry',
      value: budget,
      ministry,
    });
    if (budget > 0) {
      edges.push({ source: 'total', target: ministryId, value: budget });
    }
  }
  console.log(`  府省庁: ${ministryBudgets.size}`);

  // 6c. 事業ノード
  let projectCount = 0;
  for (const [pid, org] of orgMap) {
    projectCount++;
    const budget = budgetMap.get(pid);
    const budgetAmount = budget?.totalBudget || 0;
    const spendingAmount = projectSpendingMap.get(pid) || 0;
    const budgetNodeId = `project-budget-${pid}`;
    const spendingNodeId = `project-spending-${pid}`;

    // 事業(予算)ノード
    nodes.push({
      id: budgetNodeId,
      name: org.projectName,
      type: 'project-budget',
      value: budgetAmount,
      projectId: pid,
      ministry: org.ministry,
    });

    // 事業(支出)ノード — 直接支出額のみ
    nodes.push({
      id: spendingNodeId,
      name: org.projectName,
      type: 'project-spending',
      value: spendingAmount,
      projectId: pid,
      ministry: org.ministry,
    });

    // 府省庁 → 事業(予算)
    if (budgetAmount > 0) {
      edges.push({
        source: `ministry-${org.ministry}`,
        target: budgetNodeId,
        value: budgetAmount,
      });
    }

    // 事業(予算) → 事業(支出)
    const flowValue = Math.min(budgetAmount, spendingAmount);
    if (flowValue > 0) {
      edges.push({
        source: budgetNodeId,
        target: spendingNodeId,
        value: flowValue,
      });
    }
  }
  console.log(`  事業: ${projectCount.toLocaleString()}`);

  // 6d. 支出先ノード + エッジ（金額降順で連番IDを付与）
  const sortedRecipients = Array.from(recipientMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  for (let i = 0; i < sortedRecipients.length; i++) {
    const recipient = sortedRecipients[i];
    const recipientId = `r-${i + 1}`;
    nodes.push({
      id: recipientId,
      name: recipient.name,
      type: 'recipient',
      value: recipient.totalAmount,
    });

    for (const [pid, amount] of recipient.projectAmounts) {
      edges.push({
        source: `project-spending-${pid}`,
        target: recipientId,
        value: amount,
      });
    }
  }
  console.log(`  支出先: ${recipientMap.size.toLocaleString()}`);
  console.log(`  エッジ: ${edges.length.toLocaleString()}`);

  // 7. 出力
  const graph: SankeyGraphData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      year: YEAR,
      totalBudget,
      totalSpending: directTotalAmount + indirectTotalAmount,
      directSpending: directTotalAmount,
      indirectSpending: indirectTotalAmount,
      ministryCount: ministryBudgets.size,
      projectCount,
      recipientCount: recipientMap.size,
      edgeCount: edges.length,
    },
    nodes,
    edges,
  };

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(graph));

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`\n=== 出力 ===`);
  console.log(`  ファイル: ${outputPath}`);
  console.log(`  サイズ: ${sizeMB} MB`);

  // セルフチェック
  console.log(`\n=== セルフチェック ===`);
  console.log(`  総予算:     ${(totalBudget / 1e12).toFixed(2)} 兆円`);
  console.log(`  総支出:     ${((directTotalAmount + indirectTotalAmount) / 1e12).toFixed(2)} 兆円`);
  console.log(`  直接支出:   ${(directTotalAmount / 1e12).toFixed(2)} 兆円 (${(directTotalAmount * 100 / (directTotalAmount + indirectTotalAmount)).toFixed(1)}%)`);
  console.log(`  間接支出:   ${(indirectTotalAmount / 1e12).toFixed(2)} 兆円 (${(indirectTotalAmount * 100 / (directTotalAmount + indirectTotalAmount)).toFixed(1)}%)`);
  console.log(`  府省庁:     ${ministryBudgets.size}`);
  console.log(`  事業:       ${projectCount.toLocaleString()}`);
  console.log(`  直接支出先: ${recipientMap.size.toLocaleString()}`);

  // ノード・エッジの整合性チェック
  const nodeIds = new Set(nodes.map(n => n.id));
  let danglingEdges = 0;
  for (const e of edges) {
    if (!nodeIds.has(e.source)) { danglingEdges++; console.log(`  !! 不正エッジ source: ${e.source}`); }
    if (!nodeIds.has(e.target)) { danglingEdges++; console.log(`  !! 不正エッジ target: ${e.target}`); }
  }
  console.log(`  不正エッジ: ${danglingEdges}`);

  // フロー整合性: total → ministry の合計 = totalBudget
  const totalToMinistry = edges.filter(e => e.source === 'total').reduce((s, e) => s + e.value, 0);
  console.log(`  total→ministry合計: ${(totalToMinistry / 1e12).toFixed(2)} 兆円 (totalBudget: ${(totalBudget / 1e12).toFixed(2)} 兆円) ${totalToMinistry === totalBudget ? '✓' : '✗'}`);

  // spending→recipient の合計 = directTotalAmount
  const spendingToRecipient = edges.filter(e => e.source.startsWith('project-spending-') && e.target.startsWith('r-')).reduce((s, e) => s + e.value, 0);
  console.log(`  spending→recipient合計: ${(spendingToRecipient / 1e12).toFixed(2)} 兆円 (直接支出: ${(directTotalAmount / 1e12).toFixed(2)} 兆円) ${spendingToRecipient === directTotalAmount ? '✓' : '✗'}`);

  // ノードタイプ別カウント
  const typeCounts: Record<string, number> = {};
  for (const n of nodes) {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  }
  console.log(`  ノードタイプ別: ${JSON.stringify(typeCounts)}`);

  // value=0 のノード数
  const zeroValueNodes = nodes.filter(n => n.value === 0);
  console.log(`  value=0 ノード: ${zeroValueNodes.length} (${zeroValueNodes.filter(n => n.type === 'project-budget').length} project-budget, ${zeroValueNodes.filter(n => n.type === 'project-spending').length} project-spending)`);
}

main();
