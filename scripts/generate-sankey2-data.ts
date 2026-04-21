/**
 * /sankey2 用グラフデータ生成スクリプト
 *
 * 元CSV（data/year_2024/）から、ノード＋エッジのグラフ構造JSONを生成する。
 * 既存の generate-structured-json.ts とは独立したパイプライン。
 *
 * 出力: public/data/sankey2-graph.json（ノード・エッジ・メタデータ）
 *
 * 使用CSV:
 *   1-1: 組織情報（府省庁階層）
 *   2-1: 予算・執行サマリ（事業別予算額・執行額）
 *   5-1: 支出先・支出情報（支出先名・金額）
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';
import type { CSVRow } from '@/types/rs-system';

// ─── 定数 ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data/year_2024');
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const OUTPUT_FILE = 'sankey2-graph.json';
const TARGET_BUDGET_YEAR = 2023; // 2024年度事業 → 2023年度予算データを使用

// ─── 型定義 ──────────────────────────────────────────────

/** グラフノード */
interface Sankey2Node {
  id: string;
  label: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  amount: number;       // 1円単位
  /** project-budget/project-spending のみ: 予算事業ID */
  projectId?: number;
  /** ministry / project のみ: 府省庁名 */
  ministry?: string;
  /** recipient のみ: 間接支出（委託経由）を含むか */
  isIndirect?: boolean;
  /** recipient のみ: ユニークな委託経路リスト */
  chainPaths?: string[];
}

/** グラフエッジ */
interface Sankey2Edge {
  source: string;
  target: string;
  value: number;        // フロー金額（1円単位）
  /** エッジ種別: direct=通常支出、subcontract=再委託 */
  edgeType?: 'direct' | 'subcontract';
  /** subcontractエッジのみ: 由来する事業ID一覧 */
  projectIds?: number[];
}

/** 再委託フロー（事業単位） */
interface SubcontractFlow {
  from: string;
  to: string;
  sourceBlock: string;  // 支出元ブロック番号（例: "A"）
  targetBlock: string;  // 支出先ブロック番号（例: "B"）
  amount: number;
  recipients: { name: string; amount: number }[];
}

/** ブロック接続情報（5-2 CSV + 5-1 CSV由来） */
interface BlockConnection {
  source: string;      // ブロック番号（例: "A"）
  sourceName: string;  // ブロック名（例: "一般社団法人行政情報システム研究所"）
  target: string;      // ブロック番号（例: "B"）
  targetName: string;  // ブロック名（例: "富士通株式会社"）
  amount: number;      // targetブロックの支出合計（5-1 CSV由来）
  recipients: { name: string; amount: number }[];  // targetブロックの支出先一覧
}

/** 直接支出ブロック情報 */
interface DirectBlock {
  block: string;                   // ブロック番号（例: "A"）
  blockName: string;               // ブロック名（例: "キャッシュレス推進協議会"）
  recipients: string[];            // ブロック内の支出先名（5-1 CSV由来）
}

/** 事業ごとの再委託チェーン */
interface SubcontractChain {
  projectId: number;
  directBlocks: DirectBlock[];     // 直接支出ブロック一覧
  blockChain: BlockConnection[];   // ブロック接続の順序（A→B→C→D→E）
  flows: SubcontractFlow[];
}

/** 出力JSON */
interface Sankey2Graph {
  metadata: {
    generatedAt: string;
    totalBudget: number;
    totalSpending: number;
    projectCount: number;
    recipientCount: number;
    ministryCount: number;
    edgeCount: number;
  };
  nodes: Sankey2Node[];
  edges: Sankey2Edge[];
  subcontractChains: SubcontractChain[];
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
  console.log('=== sankey2 グラフデータ生成 ===\n');

  // 1. CSV読み込み
  console.log('[1/4] CSV読み込み');
  const orgRows = loadCSV('1-1_RS_2024_基本情報_組織情報.csv');
  const budgetRows = loadCSV('2-1_RS_2024_予算・執行_サマリ.csv');
  const spendingRows = loadCSV('5-1_RS_2024_支出先_支出情報.csv');
  const blockRows = loadCSV('5-2_RS_2024_支出先_支出ブロックのつながり.csv');

  // 2. 組織情報マップ（予算事業ID → 府省庁名）
  console.log('\n[2/4] ノード生成');
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

  // 3. 予算データ集計（予算事業ID → 予算額・執行額）
  //    会計区分ごとに複数行あるため、予算年度=2023 のみ集約
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
  console.log(`  予算データ: ${budgetMap.size.toLocaleString()} 事業（予算年度${TARGET_BUDGET_YEAR}）`);

  // 4. 支出データ集計
  //    支出先名がある個別行のみ対象（ブロック集計行は除外）
  //    支出先の一意キー: 支出先名（法人番号は参考情報として保持）
  interface RecipientAgg {
    name: string;
    totalAmount: number;
    projectAmounts: Map<number, number>; // projectId → amount
  }
  const recipientMap = new Map<string, RecipientAgg>();

  // 事業ごとの支出合計
  const projectSpendingMap = new Map<number, number>();

  let skippedNoName = 0;
  let skippedNoAmount = 0;
  let totalRows = 0;

  for (const row of spendingRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    if (!orgMap.has(pid)) continue;

    const spendingName = (row['支出先名'] || '').trim();
    if (!spendingName) { skippedNoName++; continue; }

    const amount = parseAmount(row['金額']);
    if (amount <= 0) { skippedNoAmount++; continue; }

    totalRows++;

    // 支出先集計
    const recipientKey = spendingName;
    let recipient = recipientMap.get(recipientKey);
    if (!recipient) {
      recipient = { name: spendingName, totalAmount: 0, projectAmounts: new Map() };
      recipientMap.set(recipientKey, recipient);
    }
    recipient.totalAmount += amount;
    const prevProjectAmt = recipient.projectAmounts.get(pid) || 0;
    recipient.projectAmounts.set(pid, prevProjectAmt + amount);

    // 事業別支出合計
    projectSpendingMap.set(pid, (projectSpendingMap.get(pid) || 0) + amount);
  }

  console.log(`  支出データ: ${totalRows.toLocaleString()} 行（支出先名なし=${skippedNoName.toLocaleString()}, 金額0=${skippedNoAmount.toLocaleString()}）`);
  console.log(`  ユニーク支出先: ${recipientMap.size.toLocaleString()} 件`);

  // 5. ノード生成
  console.log('\n[3/4] グラフ構築');
  const nodes: Sankey2Node[] = [];
  const edges: Sankey2Edge[] = [];

  // 5a. 全体ノード
  let totalBudget = 0;
  let totalSpending = 0;
  for (const [, b] of budgetMap) totalBudget += b.totalBudget;
  for (const [, s] of projectSpendingMap) totalSpending += s;

  nodes.push({
    id: 'total',
    label: '予算総計',
    type: 'total',
    amount: totalBudget,
  });

  // 5b. 府省庁ノード（orgMap ベース: 予算データのない事業も含む全5,664件）
  const ministryAmounts = new Map<string, { budget: number; spending: number }>();

  for (const [pid, org] of orgMap) {
    const m = org.ministry;
    const existing = ministryAmounts.get(m) || { budget: 0, spending: 0 };
    const budget = budgetMap.get(pid);
    if (budget) existing.budget += budget.totalBudget;
    existing.spending += projectSpendingMap.get(pid) || 0;
    ministryAmounts.set(m, existing);
  }

  for (const [ministry, amounts] of ministryAmounts) {
    const ministryId = `ministry-${ministry}`;
    nodes.push({
      id: ministryId,
      label: ministry,
      type: 'ministry',
      amount: amounts.budget,
      ministry,
    });
    // 全体 → 府省庁エッジ（予算額ベース）
    if (amounts.budget > 0) {
      edges.push({
        source: 'total',
        target: ministryId,
        value: amounts.budget,
      });
    }
  }
  console.log(`  府省庁: ${ministryAmounts.size} 件`);

  // 5c. 事業ノード（orgMap ベース: 全5,664事業。予算データなし=金額0）
  let projectCount = 0;
  let projectsWithoutBudget = 0;
  for (const [pid, org] of orgMap) {
    projectCount++;
    const budget = budgetMap.get(pid) || { totalBudget: 0, executedAmount: 0 };
    const spending = projectSpendingMap.get(pid) || 0;
    const budgetNodeId = `project-budget-${pid}`;
    const spendingNodeId = `project-spending-${pid}`;

    if (!budgetMap.has(pid)) projectsWithoutBudget++;

    // 事業(予算)ノード
    nodes.push({
      id: budgetNodeId,
      label: org.projectName,
      type: 'project-budget',
      amount: budget.totalBudget,
      projectId: pid,
      ministry: org.ministry,
    });

    // 事業(支出)ノード
    nodes.push({
      id: spendingNodeId,
      label: org.projectName,
      type: 'project-spending',
      amount: spending,
      projectId: pid,
      ministry: org.ministry,
    });

    // 府省庁 → 事業(予算)（予算額>0の場合のみ）
    if (budget.totalBudget > 0) {
      edges.push({
        source: `ministry-${org.ministry}`,
        target: budgetNodeId,
        value: budget.totalBudget,
      });
    }

    // 事業(予算) → 事業(支出)（両方>0の場合のみ）
    const flowValue = Math.min(budget.totalBudget, spending);
    if (flowValue > 0) {
      edges.push({
        source: budgetNodeId,
        target: spendingNodeId,
        value: flowValue,
      });
    }
  }
  console.log(`  事業: ${projectCount.toLocaleString()} 件（うち予算データなし=${projectsWithoutBudget}）`);

  // 5d. 支出先ノード
  for (const [key, recipient] of recipientMap) {
    const recipientId = `recipient-${key}`;
    nodes.push({
      id: recipientId,
      label: recipient.name,
      type: 'recipient',
      amount: recipient.totalAmount,
    });

    // 事業(支出) → 支出先エッジ
    for (const [pid, amount] of recipient.projectAmounts) {
      edges.push({
        source: `project-spending-${pid}`,
        target: recipientId,
        value: amount,
      });
    }
  }
  console.log(`  支出先: ${recipientMap.size.toLocaleString()} 件`);
  console.log(`  エッジ: ${edges.length.toLocaleString()} 件`);

  // 5e. ブロック別支出データの構築（5-1 CSV）
  // key: "pid:block" → { name, amount }[]
  console.log('\n[3.5/4] ブロック構造・再委託チェーン構築（5-2 CSV + 5-1 CSV）');
  const blockSpending = new Map<string, { name: string; amount: number }[]>();
  for (const row of spendingRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    const block = (row['支出先ブロック番号'] || '').trim();
    const name = (row['支出先名'] || '').trim();
    const amount = parseAmount(row['金額']);
    if (!block || !name || amount <= 0) continue;
    const key = `${pid}:${block}`;
    const list = blockSpending.get(key) ?? [];
    list.push({ name, amount });
    blockSpending.set(key, list);
  }

  // 5f. ブロックチェーン構造の構築（5-2 CSV）
  const blockChainByProject = new Map<number, BlockConnection[]>();
  // 直接支出ブロック（支出元が空）: pid → Map<block, blockName>
  const directBlocksByProject = new Map<number, Map<string, string>>();
  for (const row of blockRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    const source = (row['支出元の支出先ブロック'] || '').trim();
    const sourceName = (row['支出元の支出先ブロック名'] || '').trim();
    const target = (row['支出先の支出先ブロック'] || '').trim();
    const targetName = (row['支出先の支出先ブロック名'] || '').trim();
    if (!target) continue;

    if (!source) {
      // 担当組織→ブロック（直接支出）: ブロック番号・名前を記録
      const directBlocks = directBlocksByProject.get(pid) ?? new Map<string, string>();
      directBlocks.set(target, targetName);
      directBlocksByProject.set(pid, directBlocks);
      continue;
    }

    // targetブロックの支出先一覧を5-1 CSVから取得
    const targetRecipients = blockSpending.get(`${pid}:${target}`) ?? [];
    const targetAmount = targetRecipients.reduce((sum, r) => sum + r.amount, 0);

    const connections = blockChainByProject.get(pid) ?? [];
    connections.push({
      source, sourceName, target, targetName,
      amount: targetAmount,
      recipients: targetRecipients.sort((a, b) => b.amount - a.amount),
    });
    blockChainByProject.set(pid, connections);
  }
  console.log(`  ブロックチェーン: ${blockChainByProject.size.toLocaleString()} 事業`);
  console.log(`  直接ブロック事業: ${directBlocksByProject.size.toLocaleString()} 事業`);

  // 5g. 直接/間接の判定（5-2 CSVベース）
  // 直接ブロックに属する支出先 = 直接支出、それ以外 = 間接支出
  // "pid:recipientName" → 直接支出額
  const directAmountByPair = new Map<string, number>();
  // "pid:recipientName" → 間接支出あり
  const indirectPairs = new Set<string>();
  // recipientNodeのindexを作成
  const recipientNodeIndex = new Map<string, Sankey2Node>();
  for (const node of nodes) {
    if (node.type === 'recipient') {
      recipientNodeIndex.set(node.label, node);
    }
  }

  // 各事業のブロックごとに、直接/間接を判定
  for (const [pid] of orgMap) {
    const directBlockMap = directBlocksByProject.get(pid);
    const hasBlockData = directBlockMap || blockChainByProject.has(pid);
    if (!hasBlockData) continue; // ブロックデータなし → 全て直接扱い（フィルタ不要）

    const directBlocks = directBlockMap ?? new Map<string, string>();

    // 全ブロックの支出先を走査
    // blockSpendingのキーから該当pidのブロックを取得
    for (const [bsKey, recipients] of blockSpending) {
      if (!bsKey.startsWith(`${pid}:`)) continue;
      const block = bsKey.split(':')[1];
      const isDirect = directBlocks.has(block);

      for (const r of recipients) {
        const key = `${pid}:${r.name}`;
        if (isDirect) {
          directAmountByPair.set(key, (directAmountByPair.get(key) || 0) + r.amount);
        } else {
          indirectPairs.add(key);
        }
      }
    }
  }

  // 間接のみ（直接レコードがない）のペア
  const directPairKeys = new Set(directAmountByPair.keys());
  const indirectOnlyPairs = new Set([...indirectPairs].filter(k => !directPairKeys.has(k)));
  const bothPairs = [...indirectPairs].filter(k => directPairKeys.has(k));
  console.log(`  間接のみペア: ${indirectOnlyPairs.size.toLocaleString()} 件（直接+間接: ${bothPairs.length} 件）`);

  // project-spending → recipient エッジから間接のみ分を除去、両方ある場合は直接分の金額に修正
  let removedEdgeCount = 0;
  let adjustedEdgeCount = 0;
  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i];
    if (!edge.source.startsWith('project-spending-') || !edge.target.startsWith('recipient-')) continue;
    const pid = parseInt(edge.source.replace('project-spending-', ''), 10);
    const recipientName = edge.target.replace('recipient-', '');
    const key = `${pid}:${recipientName}`;
    if (indirectOnlyPairs.has(key)) {
      edges.splice(i, 1);
      removedEdgeCount++;
    } else if (indirectPairs.has(key) && directPairKeys.has(key)) {
      const directAmt = directAmountByPair.get(key) || 0;
      if (directAmt > 0) {
        edge.value = directAmt;
        adjustedEdgeCount++;
      }
    }
  }
  console.log(`  間接エッジ除去: ${removedEdgeCount.toLocaleString()} 件、金額修正: ${adjustedEdgeCount.toLocaleString()} 件`);

  // project-spending ノードの金額を直接支出のみに修正
  let amountFixCount = 0;
  for (const node of nodes) {
    if (node.type !== 'project-spending' || !node.projectId) continue;
    const directAmount = edges
      .filter(e => e.source === node.id && e.target.startsWith('recipient-'))
      .reduce((sum, e) => sum + e.value, 0);
    if (directAmount > 0 && directAmount !== node.amount) {
      node.amount = directAmount;
      amountFixCount++;
    }
  }
  console.log(`  支出額修正: ${amountFixCount.toLocaleString()} 件`);

  // 5h. isIndirect / chainPaths の付与（5-2 CSVベース）
  let enrichedCount = 0;
  // 間接支出先: indirectPairsに含まれる支出先名
  const indirectRecipientNames = new Set<string>();
  for (const key of indirectPairs) {
    const name = key.split(':').slice(1).join(':'); // "pid:name" → "name"
    indirectRecipientNames.add(name);
  }
  for (const name of indirectRecipientNames) {
    const node = recipientNodeIndex.get(name);
    if (node) {
      node.isIndirect = true;
      enrichedCount++;
    }
  }

  // chainPaths: ブロックチェーンからパスを構築
  // 各事業のブロック接続を辿り、支出先ごとにチェーンパスを生成
  for (const [pid, connections] of blockChainByProject) {
    // ブロック→親ブロックのマップを構築
    const blockParent = new Map<string, { source: string; sourceName: string }>();
    for (const conn of connections) {
      blockParent.set(conn.target, { source: conn.source, sourceName: conn.sourceName });
    }

    // 各接続のtargetブロック内の支出先にチェーンパスを付与
    for (const conn of connections) {
      // チェーンパスを逆方向に辿る（target → source → source の source → ...）
      const pathParts: string[] = [conn.targetName];
      let currentBlock = conn.source;
      const visited = new Set<string>();
      while (currentBlock && !visited.has(currentBlock)) {
        visited.add(currentBlock);
        // currentBlockの名前を取得
        const parent = blockParent.get(currentBlock);
        // currentBlockが直接ブロックならそのブロック名を追加して終了
        const directBlockMap = directBlocksByProject.get(pid);
        const directBlockName = directBlockMap?.get(currentBlock);
        if (directBlockName !== undefined) {
          pathParts.push(directBlockName || currentBlock);
          break;
        }
        if (parent) {
          pathParts.push(parent.sourceName || parent.source);
          currentBlock = parent.source;
        } else {
          break;
        }
      }
      pathParts.reverse();
      const chainPath = pathParts.join(' → ');

      // targetブロックの支出先にパスを付与
      const targetRecipients = blockSpending.get(`${pid}:${conn.target}`) ?? [];
      for (const r of targetRecipients) {
        const node = recipientNodeIndex.get(r.name);
        if (!node) continue;
        const existing = node.chainPaths || [];
        if (!existing.includes(chainPath)) {
          node.chainPaths = [...existing, chainPath];
        }
      }
    }
  }
  console.log(`  間接支出ノード: ${enrichedCount.toLocaleString()} 件`);

  // 5i. サブコントラクトエッジの生成（5-2 CSVブロック接続 + 5-1 CSV）
  // ブロック接続 A→B: ブロック名Aが支出先ノードに一致する場合のみ → ブロックBの各支出先 のエッジを生成
  // ブロック名がカテゴリ名（都府県、市町村等）の場合はエッジを生成しない（CSVにない関係の捏造を防止）
  let subcontractEdgeCount = 0;
  let skippedNoSource = 0;
  const subcontractAmounts = new Map<string, number>();
  const subcontractProjectIds = new Map<string, Set<number>>();
  // 二重計上防止: "pid:targetBlock:targetRecipientName" → 計上済みフラグ
  const countedTargets = new Set<string>();

  for (const [pid, connections] of blockChainByProject) {
    for (const conn of connections) {
      // sourceブロック名が支出先ノードに一致する場合のみエッジ生成
      // ブロック名がカテゴリ名（都府県、市町村等）の場合はスキップ
      const sourceNode = recipientNodeIndex.get(conn.sourceName);
      if (!sourceNode) { skippedNoSource++; continue; }

      // targetブロックの各支出先へエッジ生成（二重計上チェック付き）
      const targetRecipients = conn.recipients;
      for (const tr of targetRecipients) {
        const targetNode = recipientNodeIndex.get(tr.name);
        if (!targetNode) continue;
        if (sourceNode.id === targetNode.id) continue;

        // 同一事業・同一ターゲットブロック・同一支出先への二重計上防止
        const countKey = `${pid}:${conn.target}:${tr.name}`;
        if (countedTargets.has(countKey)) continue;
        countedTargets.add(countKey);

        const edgeKey = `${sourceNode.id}→${targetNode.id}`;
        subcontractAmounts.set(edgeKey, (subcontractAmounts.get(edgeKey) || 0) + tr.amount);
        if (!subcontractProjectIds.has(edgeKey)) subcontractProjectIds.set(edgeKey, new Set());
        subcontractProjectIds.get(edgeKey)!.add(pid);
      }
    }
  }
  console.log(`  ソース支出先なしスキップ: ${skippedNoSource.toLocaleString()} 件`);

  // 累積結果をエッジに変換
  for (const [edgeKey, amount] of subcontractAmounts) {
    if (amount <= 0) continue;
    const [sourceId, targetId] = edgeKey.split('→');
    const pids = subcontractProjectIds.get(edgeKey);

    edges.push({
      source: sourceId,
      target: targetId,
      value: amount,
      edgeType: 'subcontract',
      projectIds: pids ? [...pids].sort((a, b) => a - b) : undefined,
    });
    subcontractEdgeCount++;
  }
  console.log(`  再委託エッジ: ${subcontractEdgeCount.toLocaleString()} 件`);

  console.log(`  最終エッジ数: ${edges.length.toLocaleString()} 件`);

  // 5j. 再委託チェーンの事業別集約（5-2 CSV + 5-1 CSVのみ）
  const subcontractChains: SubcontractChain[] = [];
  {
    // ブロック接続からflowsを生成（outflows不要）
    const flowsByProject = new Map<number, SubcontractFlow[]>();
    for (const [pid, connections] of blockChainByProject) {
      for (const conn of connections) {
        const flows = flowsByProject.get(pid) ?? [];
        flows.push({
          from: conn.sourceName,
          to: conn.targetName,
          sourceBlock: conn.source,
          targetBlock: conn.target,
          amount: conn.amount,
          recipients: conn.recipients.map(r => ({ name: r.name, amount: r.amount })),
        });
        flowsByProject.set(pid, flows);
      }
    }

    // ブロック構造を持つ全事業
    const allProjectIds = new Set([...flowsByProject.keys(), ...blockChainByProject.keys(), ...directBlocksByProject.keys()]);
    for (const projectId of allProjectIds) {
      const flows = flowsByProject.get(projectId) ?? [];
      const blockChain = (blockChainByProject.get(projectId) ?? []).sort(
        (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
      );
      const directBlockMap = directBlocksByProject.get(projectId) ?? new Map<string, string>();
      const directBlocks: DirectBlock[] = [...directBlockMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([block, blockName]) => ({
          block,
          blockName,
          recipients: (blockSpending.get(`${projectId}:${block}`) ?? []).map(r => r.name),
        }));
      subcontractChains.push({ projectId, directBlocks, blockChain, flows });
    }
    console.log(`  再委託チェーン: ${subcontractChains.length.toLocaleString()} 事業`);
  }

  // 6. 出力
  console.log('\n[4/4] JSON出力');
  const graph: Sankey2Graph = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalBudget,
      totalSpending,
      projectCount,
      recipientCount: recipientMap.size,
      ministryCount: ministryAmounts.size,
      edgeCount: edges.length,
    },
    nodes,
    edges,
    subcontractChains,
  };

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(graph));

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`  出力: ${outputPath}`);
  console.log(`  サイズ: ${sizeMB} MB`);
  console.log(`
=== サマリ ===
  総予算: ${(totalBudget / 1e12).toFixed(2)} 兆円
  総支出: ${(totalSpending / 1e12).toFixed(2)} 兆円
  府省庁: ${ministryAmounts.size} 件
  事業:   ${projectCount.toLocaleString()} 件（うち予算データなし=${projectsWithoutBudget}）
  支出先: ${recipientMap.size.toLocaleString()} 件
  エッジ: ${edges.length.toLocaleString()} 件
`);
}

main();
