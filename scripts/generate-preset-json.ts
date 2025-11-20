/**
 * RS2024プリセットJSON生成スクリプト
 *
 * 完全データ (rs2024-structured.json) からTop3プリセットを生成
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord } from '../types/structured';
import type {
  RS2024PresetData,
  SankeyNode,
  SankeyLink,
  MinistryNodeDetails,
  ProjectBudgetNodeDetails,
  ProjectSpendingNodeDetails,
  RecipientNodeDetails,
} from '../types/preset';

// 定数
const DATA_DIR = path.join(__dirname, '../public/data');
const SOURCE_FILE = 'rs2024-structured.json';
const OUTPUT_FILE = 'rs2024-preset-top3.json';
const TOP_N = 3; // Top3設定

/**
 * メイン処理
 */
async function main() {
  console.log('RS2024プリセットJSON生成開始...\n');

  // 1. 完全データの読み込み
  console.log(`完全データ読み込み中: ${SOURCE_FILE}`);
  const sourcePath = path.join(DATA_DIR, SOURCE_FILE);
  const rawData = fs.readFileSync(sourcePath, 'utf-8');
  const fullData: RS2024StructuredData = JSON.parse(rawData);
  console.log('✓ 完全データ読み込み完了');

  // 2. Top3選択
  console.log('\nTop3選択中...');
  const {
    topMinistries,
    otherMinistriesBudget,
    topProjects,
    otherProjectsBudgetByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject
  } = selectTop3(fullData);
  console.log(`✓ Top3府省庁: ${topMinistries.map(m => m.name).join(', ')}`);
  console.log(`✓ その他の府省庁予算: ${(otherMinistriesBudget / 1e12).toFixed(2)}兆円`);
  console.log(`✓ Top3事業数: ${topProjects.length}`);
  console.log(`✓ Top3支出先数: ${topSpendings.length}`);

  // 3. サンキーデータ生成
  console.log('\nサンキーデータ生成中...');
  const sankeyData = buildSankeyData(
    topMinistries,
    otherMinistriesBudget,
    topProjects,
    otherProjectsBudgetByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject,
    fullData
  );
  console.log(`✓ ノード数: ${sankeyData.nodes.length}`);
  console.log(`✓ リンク数: ${sankeyData.links.length}`);

  // 4. メタデータ生成
  console.log('\nメタデータ生成中...');
  const selectedBudget = topProjects.reduce((sum, p) => sum + p.totalBudget, 0);
  const coverageRate = (selectedBudget / fullData.metadata.totalBudgetAmount) * 100;

  const presetData: RS2024PresetData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      fiscalYear: 2024,
      presetType: 'top3',
      sourceFile: SOURCE_FILE,
      filterSettings: {
        topMinistries: TOP_N,
        topProjects: TOP_N,
        topSpendings: TOP_N,
        sortBy: 'budget',
      },
      summary: {
        totalMinistries: fullData.budgetTree.ministries.length,
        totalProjects: fullData.metadata.totalProjects,
        totalSpendings: fullData.metadata.totalRecipients,
        selectedMinistries: topMinistries.length,
        selectedProjects: topProjects.length,
        selectedSpendings: topSpendings.length,
        totalBudget: fullData.metadata.totalBudgetAmount,
        selectedBudget: selectedBudget,
        coverageRate: coverageRate,
      },
    },
    sankey: sankeyData,
  };

  // 5. JSON出力
  const outputPath = path.join(DATA_DIR, OUTPUT_FILE);
  console.log(`\nJSON出力中: ${outputPath}`);
  fs.writeFileSync(outputPath, JSON.stringify(presetData, null, 2), 'utf-8');

  const fileSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2);
  console.log(`✅ プリセット生成完了 (ファイルサイズ: ${fileSizeKB}KB)`);

  console.log(`\n統計:
  - Top3府省庁: ${topMinistries.map(m => m.name).join(', ')}
  - Top3事業数: ${topProjects.length}
  - Top3支出先数: ${topSpendings.length}
  - カバー率: ${coverageRate.toFixed(2)}%
  - 選択予算額: ${(selectedBudget / 1e12).toFixed(2)}兆円
  `);
}

/**
 * 再帰的Top3選択アルゴリズム（"その他"を含む）
 * 各階層で親ごとにTop3を選択し、それ以外を"その他"として集約
 */
function selectTop3(data: RS2024StructuredData): {
  topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>;
  otherMinistriesBudget: number;
  topProjects: BudgetRecord[];
  otherProjectsBudgetByMinistry: Map<string, number>;
  topSpendings: SpendingRecord[];
  otherSpendingsByProject: Map<number, number>;
  otherNamedSpendingByProject: Map<number, number>;
} {
  // ステップ1: Top3府省庁を選択（予算額順）
  const sortedMinistries = data.budgetTree.ministries
    .sort((a, b) => b.totalBudget - a.totalBudget);

  const topMinistries = sortedMinistries
    .slice(0, TOP_N)
    .map(m => ({
      name: m.name,
      id: m.id,
      totalBudget: m.totalBudget,
      bureauCount: m.bureaus.length,
    }));

  // その他の府省庁の予算合計
  const otherMinistriesBudget = sortedMinistries
    .slice(TOP_N)
    .reduce((sum, m) => sum + m.totalBudget, 0);

  const topMinistryNames = topMinistries.map(m => m.name);

  // ステップ2: 各府省庁ごとにTop3事業を選択（予算額順）
  const topProjects: BudgetRecord[] = [];
  const otherProjectsBudgetByMinistry = new Map<string, number>();

  for (const ministry of topMinistryNames) {
    const ministryProjects = data.budgets
      .filter(p => p.ministry === ministry)
      .sort((a, b) => b.totalBudget - a.totalBudget);

    // Top3事業
    const top3 = ministryProjects.slice(0, TOP_N);
    topProjects.push(...top3);

    // その他の事業の予算合計
    const otherBudget = ministryProjects
      .slice(TOP_N)
      .reduce((sum, p) => sum + p.totalBudget, 0);

    if (otherBudget > 0) {
      otherProjectsBudgetByMinistry.set(ministry, otherBudget);
    }
  }

  // ステップ3a: 全事業から支出先名「その他」への支出を集計
  const otherNamedSpendingByProject = new Map<number, number>();
  let totalOtherNamedSpending = 0;

  for (const project of data.budgets) {
    const projectSpendings = data.spendings
      .filter(s => project.spendingIds.includes(s.spendingId))
      .filter(s => s.spendingName === 'その他');

    const otherNamedTotal = projectSpendings.reduce((sum, s) => {
      const projectSpending = s.projects.find(p => p.projectId === project.projectId);
      return sum + (projectSpending?.amount || 0);
    }, 0);

    if (otherNamedTotal > 0) {
      otherNamedSpendingByProject.set(project.projectId, otherNamedTotal);
      totalOtherNamedSpending += otherNamedTotal;
    }
  }

  // ステップ3b: 各Top3事業ごとにTop3支出先を選択（支出額順、「その他」を除く）
  const topSpendingIds = new Set<number>();
  const otherSpendingsByProject = new Map<number, number>();

  for (const project of topProjects) {
    // この事業の支出先を取得（「その他」を除く）
    const projectSpendings = data.spendings
      .filter(s => project.spendingIds.includes(s.spendingId))
      .filter(s => s.spendingName !== 'その他')
      .map(s => {
        // この事業からの支出額を計算
        const projectSpending = s.projects.find(p => p.projectId === project.projectId);
        return {
          spending: s,
          amountFromThisProject: projectSpending?.amount || 0,
        };
      });

    // 支出額でソートしてTop3を選択
    const sortedSpendings = projectSpendings.sort((a, b) => b.amountFromThisProject - a.amountFromThisProject);
    const top3Spendings = sortedSpendings.slice(0, TOP_N);

    for (const { spending } of top3Spendings) {
      topSpendingIds.add(spending.spendingId);
    }

    // その他の支出先の合計（Top3以外すべて、「その他」という名前のものは含まない）
    const otherSpendingTotal = sortedSpendings
      .slice(TOP_N)
      .reduce((sum, { amountFromThisProject }) => sum + amountFromThisProject, 0);

    if (otherSpendingTotal > 0) {
      otherSpendingsByProject.set(project.projectId, otherSpendingTotal);
    }
  }

  // 支出先レコードを取得
  const topSpendings = data.spendings.filter(s => topSpendingIds.has(s.spendingId));

  return {
    topMinistries,
    otherMinistriesBudget,
    topProjects,
    otherProjectsBudgetByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject, // 各事業の「その他」支出額
  };
}

/**
 * 各府省庁のTop3以外の事業からの「その他」支出を集計するヘルパー関数
 */
function calculateOtherProjectsOtherNamedByMinistry(
  topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>,
  topProjects: BudgetRecord[],
  otherNamedSpendingByProject: Map<number, number>,
  fullData: RS2024StructuredData
): { byMinistryId: Map<number, number>; byMinistryName: Map<string, number> } {
  const byMinistryId = new Map<number, number>();
  const byMinistryName = new Map<string, number>();

  for (const ministry of topMinistries) {
    const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);
    const ministryProjectIds = new Set(ministryProjects.map(p => p.projectId));
    const allMinistryProjectIds = fullData.budgets
      .filter(b => b.ministry === ministry.name)
      .map(b => b.projectId);

    let otherProjectsOtherNamedAmount = 0;
    for (const projectId of allMinistryProjectIds) {
      if (!ministryProjectIds.has(projectId)) {
        const amount = otherNamedSpendingByProject.get(projectId);
        if (amount) {
          otherProjectsOtherNamedAmount += amount;
        }
      }
    }

    if (otherProjectsOtherNamedAmount > 0) {
      byMinistryId.set(ministry.id, otherProjectsOtherNamedAmount);
      byMinistryName.set(ministry.name, otherProjectsOtherNamedAmount);
    }
  }

  return { byMinistryId, byMinistryName };
}

/**
 * その他の府省庁からの「その他」支出を集計するヘルパー関数
 */
function calculateOtherMinistriesOtherNamed(
  topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>,
  otherNamedSpendingByProject: Map<number, number>,
  fullData: RS2024StructuredData
): number {
  const topMinistryNames = new Set(topMinistries.map(m => m.name));
  let otherMinistriesOtherNamedAmount = 0;

  for (const [projectId, amount] of otherNamedSpendingByProject.entries()) {
    const project = fullData.budgets.find(b => b.projectId === projectId);
    if (project && !topMinistryNames.has(project.ministry)) {
      otherMinistriesOtherNamedAmount += amount;
    }
  }

  return otherMinistriesOtherNamedAmount;
}

/**
 * サンキーデータ構築（5列構成 + "その他"ノード）
 * 列0: 予算総計 → 列1: 府省庁（予算） → 列2: 事業（予算） → 列3: 事業（支出） → 列4: 支出先
 */
function buildSankeyData(
  topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>,
  otherMinistriesBudget: number,
  topProjects: BudgetRecord[],
  otherProjectsBudgetByMinistry: Map<string, number>,
  topSpendings: SpendingRecord[],
  otherSpendingsByProject: Map<number, number>,
  otherNamedSpendingByProject: Map<number, number>,
  fullData: RS2024StructuredData
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // 列0: 予算総計ノード生成
  const totalBudget = topMinistries.reduce((sum, m) => sum + m.totalBudget, 0) + otherMinistriesBudget;
  nodes.push({
    id: 'total-budget',
    name: '予算総計',
    type: 'ministry-budget',
    value: totalBudget,
    details: {
      projectCount: topProjects.length,
      bureauCount: topMinistries.reduce((sum, m) => sum + m.bureauCount, 0),
    },
  });

  // 列1: 府省庁（予算）ノード生成
  const ministryNodes: SankeyNode[] = [];
  for (const ministry of topMinistries) {
    const projectCount = topProjects.filter(p => p.ministry === ministry.name).length;

    const details: MinistryNodeDetails = {
      projectCount: projectCount,
      bureauCount: ministry.bureauCount,
    };

    ministryNodes.push({
      id: `ministry-budget-${ministry.id}`,
      name: `${ministry.name}`,
      type: 'ministry-budget',
      value: ministry.totalBudget,
      originalId: ministry.id,
      details: details,
    });
  }

  // 列1: その他の府省庁ノード（一番下に配置）
  let hasOtherMinistry = false;
  if (otherMinistriesBudget > 0) {
    ministryNodes.push({
      id: 'ministry-budget-other',
      name: 'その他の府省庁',
      type: 'ministry-budget',
      value: otherMinistriesBudget,
      details: {
        projectCount: 0,
        bureauCount: 0,
      },
    });
    hasOtherMinistry = true;
  }

  nodes.push(...ministryNodes);

  // 列2: 事業（予算）ノード生成（府省庁ごとにグループ化し、その他を最後に）
  const projectBudgetNodes: SankeyNode[] = [];

  for (const ministry of topMinistries) {
    // この府省庁のTop3事業を追加
    const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);

    for (const project of ministryProjects) {
      const details: ProjectBudgetNodeDetails = {
        ministry: project.ministry,
        bureau: project.bureau,
        fiscalYear: project.fiscalYear,
        initialBudget: project.initialBudget,
        supplementaryBudget: project.supplementaryBudget,
        carryoverBudget: project.carryoverBudget,
        reserveFund: project.reserveFund,
        totalBudget: project.totalBudget,
        executedAmount: project.executedAmount,
        carryoverToNext: project.carryoverToNext,
        accountCategory: project.accountCategory,
      };

      projectBudgetNodes.push({
        id: `project-budget-${project.projectId}`,
        name: project.projectName,
        type: 'project-budget',
        value: project.totalBudget,
        originalId: project.projectId,
        details: details,
      });

      // リンク1: 府省庁（予算）→ 事業（予算）
      links.push({
        source: `ministry-budget-${ministry.id}`,
        target: `project-budget-${project.projectId}`,
        value: project.totalBudget,
      });
    }

    // この府省庁の"その他の事業"を追加（一番下）
    const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
    if (otherBudget && otherBudget > 0) {
      projectBudgetNodes.push({
        id: `project-budget-other-${ministry.id}`,
        name: 'その他の事業',
        type: 'project-budget',
        value: otherBudget,
        details: {
          ministry: ministry.name,
          bureau: '',
          fiscalYear: 2024,
          initialBudget: otherBudget,
          supplementaryBudget: 0,
          carryoverBudget: 0,
          reserveFund: 0,
          totalBudget: otherBudget,
          executedAmount: 0,
          carryoverToNext: 0,
          accountCategory: '',
        },
      });

      // リンク: 府省庁 → その他の事業（予算）
      links.push({
        source: `ministry-budget-${ministry.id}`,
        target: `project-budget-other-${ministry.id}`,
        value: otherBudget,
      });
    }
  }

  // 「その他の府省庁」は直接「その他の支出先」にリンクするため、
  // 「その他の事業」ノードは作成しない

  nodes.push(...projectBudgetNodes);

  // リンク0: 予算総計 → 府省庁（予算）
  for (const ministry of topMinistries) {
    links.push({
      source: 'total-budget',
      target: `ministry-budget-${ministry.id}`,
      value: ministry.totalBudget,
    });
  }

  // リンク0: 予算総計 → その他の府省庁
  if (otherMinistriesBudget > 0) {
    links.push({
      source: 'total-budget',
      target: 'ministry-budget-other',
      value: otherMinistriesBudget,
    });
    // その他の府省庁 → その他の支出先のリンクは後で作成
  }

  // 列3: 事業（支出）ノード生成（府省庁ごとにグループ化し、その他を最後に）
  const projectSpendingNodes: SankeyNode[] = [];

  for (const ministry of topMinistries) {
    // この府省庁のTop3事業を追加
    const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);

    for (const project of ministryProjects) {
      const spendingCount = project.spendingIds.length;

      const details: ProjectSpendingNodeDetails = {
        ministry: project.ministry,
        bureau: project.bureau,
        fiscalYear: project.fiscalYear,
        executionRate: project.executionRate,
        spendingCount: spendingCount,
      };

      projectSpendingNodes.push({
        id: `project-spending-${project.projectId}`,
        name: project.projectName,
        type: 'project-spending',
        value: project.totalSpendingAmount,
        originalId: project.projectId,
        details: details,
      });

      // リンク2: 事業（予算）→ 事業（支出）
      // リンクの太さは予算額と支出額の小さい方
      const linkValue = Math.min(project.totalBudget, project.totalSpendingAmount);
      links.push({
        source: `project-budget-${project.projectId}`,
        target: `project-spending-${project.projectId}`,
        value: linkValue,
      });
    }

    // この府省庁の"その他の事業（支出）"は作成しない
    // 「その他の事業（予算）」から直接「その他の支出先」へリンクする
  }

  nodes.push(...projectSpendingNodes);

  // 列4: 支出先ノード生成（事業ごとにグループ化し、その他を最後に）
  const recipientNodes: SankeyNode[] = [];

  for (const project of topProjects) {
    // この事業のTop3支出先を追加
    for (const spending of topSpendings) {
      // この支出先がこの事業からの支出を含むかチェック
      const spendingProject = spending.projects.find(p => p.projectId === project.projectId);
      if (spendingProject) {
        // まだ追加されていない支出先のみ追加
        if (!recipientNodes.some(n => n.id === `recipient-${spending.spendingId}`)) {
          const details: RecipientNodeDetails = {
            corporateNumber: spending.corporateNumber,
            location: spending.location,
            projectCount: spending.projectCount,
          };

          recipientNodes.push({
            id: `recipient-${spending.spendingId}`,
            name: spending.spendingName,
            type: 'recipient',
            value: spending.totalSpendingAmount,
            originalId: spending.spendingId,
            details: details,
          });
        }

        // リンク3: 事業（支出）→ 支出先
        links.push({
          source: `project-spending-${project.projectId}`,
          target: `recipient-${spending.spendingId}`,
          value: spendingProject.amount,
          details: {
            contractMethod: spendingProject.contractMethod,
            blockName: spendingProject.blockName,
          },
        });
      }
    }
  }

  // 「その他」という名前の支出先への支出を集約した単一ノードを作成
  let totalOtherNamedAmount = 0;
  for (const [, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
    totalOtherNamedAmount += otherNamedAmount;
  }

  if (totalOtherNamedAmount > 0) {
    recipientNodes.push({
      id: 'recipient-other-named',
      name: 'その他',
      type: 'recipient',
      value: totalOtherNamedAmount,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: 0,
      },
    });

    // Top3事業のIDセット
    const topProjectIds = new Set(topProjects.map(p => p.projectId));

    // リンク: Top3事業（支出）→ 「その他」ノード
    for (const [projectId, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
      if (otherNamedAmount > 0 && topProjectIds.has(projectId)) {
        links.push({
          source: `project-spending-${projectId}`,
          target: 'recipient-other-named',
          value: otherNamedAmount,
        });
      }
    }

    // 各府省庁のTop3以外の事業からの「その他」支出を集計
    const { byMinistryId: otherProjectsOtherNamedByMinistryId, byMinistryName: otherProjectsOtherNamedByMinistryName } =
      calculateOtherProjectsOtherNamedByMinistry(topMinistries, topProjects, otherNamedSpendingByProject, fullData);

    // リンク: 各府省庁の「その他の事業（予算）」→ 「その他」ノード
    for (const [ministryId, amount] of otherProjectsOtherNamedByMinistryId.entries()) {
      links.push({
        source: `project-budget-other-${ministryId}`,
        target: 'recipient-other-named',
        value: amount,
      });
    }

    // その他の府省庁からの「その他」支出を集計
    const otherMinistriesOtherNamedAmount = calculateOtherMinistriesOtherNamed(topMinistries, otherNamedSpendingByProject, fullData);

    // リンク: 「その他の府省庁」→ 「その他」ノード
    if (otherMinistriesOtherNamedAmount > 0) {
      links.push({
        source: 'ministry-budget-other',
        target: 'recipient-other-named',
        value: otherMinistriesOtherNamedAmount,
      });
    }
  }

  // 集約した「その他の支出先」ノードを作成
  // 1. その他の事業（予算）からの金額（予算ベース）- 「その他」支出先への金額を除く
  // 2. その他の府省庁の予算額 - 「その他」支出先への金額を除く
  // 3. Top3事業からのTopN以外の支出先への金額
  // 注意: 「その他」という名前の支出先への金額は含まない（別ノード）
  let totalOtherRecipientAmount = 0;

  // 各府省庁のTop3以外の事業からの「その他」支出を集計（「その他の支出先」計算用）
  const otherProjectsOtherNamedByMinistryNameForRecipient =
    totalOtherNamedAmount > 0
      ? calculateOtherProjectsOtherNamedByMinistry(topMinistries, topProjects, otherNamedSpendingByProject, fullData).byMinistryName
      : new Map<string, number>();

  // その他の府省庁からの「その他」支出を集計（「その他の支出先」計算用）
  const otherMinistriesOtherNamedAmountForRecipient =
    totalOtherNamedAmount > 0
      ? calculateOtherMinistriesOtherNamed(topMinistries, otherNamedSpendingByProject, fullData)
      : 0;

  // Top3府省庁のその他事業の予算額を集計（「その他」支出先への金額を除く）
  for (const ministry of topMinistries) {
    const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name) || 0;
    const otherNamedAmount = otherProjectsOtherNamedByMinistryNameForRecipient.get(ministry.name) || 0;
    const adjustedBudget = otherBudget - otherNamedAmount;
    if (adjustedBudget > 0) {
      totalOtherRecipientAmount += adjustedBudget;
    }
  }

  // その他の府省庁の予算額を追加（「その他」支出先への金額を除く）
  if (hasOtherMinistry) {
    const adjustedOtherMinistriesBudget = otherMinistriesBudget - otherMinistriesOtherNamedAmountForRecipient;
    if (adjustedOtherMinistriesBudget > 0) {
      totalOtherRecipientAmount += adjustedOtherMinistriesBudget;
    }
  }

  // Top3事業からのTopN以外の支出先への金額を追加
  for (const [, otherAmount] of otherSpendingsByProject.entries()) {
    totalOtherRecipientAmount += otherAmount;
  }

  // 集約した「その他の支出先」ノードを作成
  if (totalOtherRecipientAmount > 0) {
    recipientNodes.push({
      id: 'recipient-other-aggregated',
      name: 'その他の支出先',
      type: 'recipient',
      value: totalOtherRecipientAmount,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: 0,
      },
    });

    // リンク: 各「その他の事業（予算）」→ 集約した「その他の支出先」
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherBudget && otherBudget > 0) {
        links.push({
          source: `project-budget-other-${ministry.id}`,
          target: 'recipient-other-aggregated',
          value: otherBudget,
        });
      }
    }

    // リンク: その他の府省庁 → 集約した「その他の支出先」（直接）
    if (hasOtherMinistry) {
      links.push({
        source: 'ministry-budget-other',
        target: 'recipient-other-aggregated',
        value: otherMinistriesBudget,
      });
    }

    // リンク: Top3事業（支出）→ 集約した「その他の支出先」（TopN以外の支出先）
    for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
      if (otherAmount > 0) {
        links.push({
          source: `project-spending-${projectId}`,
          target: 'recipient-other-aggregated',
          value: otherAmount,
        });
      }
    }
  }

  // 受取先ノードを並び替え：
  // 1. 通常の受取先（「その他」と集約ノード以外）
  // 2. 「その他」ノード
  // 3. 集約した「その他の支出先」
  const regularRecipients = recipientNodes.filter(
    n => n.id !== 'recipient-other-aggregated' && n.id !== 'recipient-other-named'
  );
  const otherNamedRecipient = recipientNodes.filter(n => n.id === 'recipient-other-named');
  const aggregatedOther = recipientNodes.filter(n => n.id === 'recipient-other-aggregated');

  nodes.push(...regularRecipients, ...otherNamedRecipient, ...aggregatedOther);

  return { nodes, links };
}

// 実行
main().catch(error => {
  console.error('❌ エラーが発生しました:', error);
  process.exit(1);
});
