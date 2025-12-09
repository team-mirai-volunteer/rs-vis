import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord } from '@/types/structured';
import type {
  RS2024PresetData,
  SankeyNode,
  SankeyLink,
} from '@/types/preset';

// Cache the data in memory to avoid re-reading the large JSON file
let cachedData: RS2024StructuredData | null = null;

// Cache for generated results to avoid re-processing for same parameters
const resultCache = new Map<string, RS2024PresetData>();
const CACHE_SIZE_LIMIT = 100;

interface GenerateOptions {
  ministryOffset?: number;
  projectOffset?: number; // Deprecated: use projectDrilldownLevel instead
  ministryLimit?: number;
  projectLimit?: number;
  spendingLimit?: number;
  targetMinistryName?: string;
  targetProjectName?: string;
  targetRecipientName?: string;
  drilldownLevel?: number; // Ministry drilldown: 0: Top10, 1: Top11-20, 2: Top21-30, etc.
  projectDrilldownLevel?: number; // Project drilldown (Ministry View): 0: Top10, 1: Top11-20, etc.
}

function getCacheKey(options: GenerateOptions): string {
  // Canonicalize options with defaults
  const canonicalOptions = {
    ministryOffset: options.ministryOffset ?? 0,
    projectOffset: options.projectOffset ?? 0, // Keep for backward compatibility
    projectDrilldownLevel: options.projectDrilldownLevel ?? 0,
    ministryLimit: options.ministryLimit ?? 3,
    projectLimit: options.projectLimit ?? 3,
    spendingLimit: options.spendingLimit ?? 5,
    targetMinistryName: options.targetMinistryName ?? '',
    targetProjectName: options.targetProjectName ?? '',
    targetRecipientName: options.targetRecipientName ?? '',
    drilldownLevel: options.drilldownLevel ?? 0,
  };
  return JSON.stringify(canonicalOptions);
}

export async function generateSankeyData(options: GenerateOptions = {}): Promise<RS2024PresetData> {
  const cacheKey = getCacheKey(options);

  if (resultCache.has(cacheKey)) {
    // console.log('Cache hit for key:', cacheKey);
    return resultCache.get(cacheKey)!;
  }
  // console.log('Cache miss for key:', cacheKey);

  const {
    ministryOffset = 0,
    projectOffset = 0, // Deprecated
    projectDrilldownLevel = 0,
    ministryLimit = 3,
    projectLimit = 3,
    spendingLimit = 5,
    targetMinistryName,
    targetProjectName,
    targetRecipientName,
    drilldownLevel = 0,
  } = options;

  // Calculate projectOffset from projectDrilldownLevel (prioritize projectDrilldownLevel)
  const calculatedProjectOffset = projectDrilldownLevel > 0
    ? projectDrilldownLevel * projectLimit
    : projectOffset;

  // 1. Load data
  if (!cachedData) {
    const dataPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
    try {
      const rawData = fs.readFileSync(dataPath, 'utf-8');
      cachedData = JSON.parse(rawData);
    } catch (error) {
      console.error('Failed to load structured data:', error);
      throw new Error('Failed to load data source');
    }
  }
  const fullData = cachedData!;

  // 2. Select Data
  const selection = selectData(fullData, {
    offset: ministryOffset,
    projectOffset: calculatedProjectOffset,
    limit: ministryLimit,
    projectLimit,
    spendingLimit,
    targetMinistryName,
    targetProjectName,
    targetRecipientName,
    drilldownLevel,
  });

  // 3. Build Sankey Data
  const sankeyData = buildSankeyData(
    selection,
    fullData,
    {
      offset: ministryOffset,
      targetMinistryName,
      targetProjectName,
      targetRecipientName,
      ministryLimit,
      projectLimit,
      spendingLimit,
      drilldownLevel,
    }
  );

  // 4. Generate Metadata
  // Calculate selected budget based on view type
  let selectedBudget = 0;
  if (targetRecipientName) {
    // For spending view, sum of selected projects
    selectedBudget = selection.topProjects.reduce((sum, p) => sum + p.totalBudget, 0);
  } else {
    selectedBudget = selection.topProjects.reduce((sum, p) => sum + p.totalBudget, 0);
  }

  const coverageRate = (selectedBudget / fullData.metadata.totalBudgetAmount) * 100;

  let presetType = 'global';
  if (targetMinistryName) presetType = 'ministry';
  if (targetProjectName) presetType = 'project';
  if (targetRecipientName) presetType = 'spending';

  const result: RS2024PresetData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      fiscalYear: 2024,
      presetType,
      sourceFile: 'rs2024-structured.json',
      filterSettings: {
        topMinistries: ministryLimit,
        topProjects: projectLimit,
        topSpendings: spendingLimit,
        sortBy: 'budget',
      },
      summary: {
        totalMinistries: fullData.budgetTree.ministries.length,
        totalProjects: fullData.metadata.totalProjects,
        totalSpendings: fullData.metadata.totalRecipients,
        selectedMinistries: selection.topMinistries.length,
        selectedProjects: selection.topProjects.length,
        selectedSpendings: targetRecipientName ? 1 : selection.topSpendings.length, // Spending view has 1 recipient
        totalBudget: fullData.metadata.totalBudgetAmount,
        selectedBudget: selectedBudget,
        coverageRate: coverageRate,
        ministryTotalProjects: selection.ministryTotalProjects,
      },
    },
    sankey: sankeyData,
  };

  // Update cache
  if (resultCache.size >= CACHE_SIZE_LIMIT) {
    const firstKey = resultCache.keys().next().value;
    if (firstKey) resultCache.delete(firstKey);
  }
  resultCache.set(cacheKey, result);

  return result;
}

interface DataSelection {
  topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>;
  otherMinistriesBudget: number;
  otherMinistriesSpending: number; // Spending amount for "Other Ministries"
  topProjects: BudgetRecord[];
  otherProjectsBudgetByMinistry: Map<string, number>;
  otherProjectsSpendingByMinistry: Map<string, number>; // Spending amount for "Other Projects"
  topSpendings: SpendingRecord[];
  otherSpendingsByProject: Map<number, number>;
  otherNamedSpendingByProject: Map<number, number>;

  // Spending View用
  otherProjectsSpendingInSpendingView?: number; // TopN以外のプロジェクトからの支出金額
  otherProjectsSpendingByMinistryInSpendingView?: Map<string, number>; // 府省庁別のTopN以外プロジェクト支出金額
  otherMinistriesSpendingInSpendingView?: number; // TopN以外の府省庁からの支出金額
  hasMoreProjects?: boolean; // ページネーション可能かどうか

  // Ministry View用
  ministryTotalProjects?: number; // 選択した府省庁の総事業数
}

function selectData(
  data: RS2024StructuredData,
  options: {
    offset: number;
    projectOffset: number;
    limit: number;
    projectLimit: number;
    spendingLimit: number;
    targetMinistryName?: string;
    targetProjectName?: string;
    targetRecipientName?: string;
    drilldownLevel?: number;
  }
): DataSelection {
  const { offset, projectOffset, limit, projectLimit, spendingLimit, targetMinistryName, targetProjectName, targetRecipientName, drilldownLevel = 0 } = options;

  // Initialize result containers
  let topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }> = [];
  let otherMinistriesBudget = 0;
  let otherMinistriesSpending = 0;
  let topProjects: BudgetRecord[] = [];
  const otherProjectsBudgetByMinistry = new Map<string, number>();
  const otherProjectsSpendingByMinistry = new Map<string, number>();
  let topSpendings: SpendingRecord[] = [];
  const otherSpendingsByProject = new Map<number, number>();
  const otherNamedSpendingByProject = new Map<number, number>();

  // Spending View用
  let otherProjectsSpendingInSpendingView: number | undefined = undefined;
  let otherProjectsSpendingByMinistryInSpendingView: Map<string, number> | undefined = undefined;
  let otherMinistriesSpendingInSpendingView: number | undefined = undefined;
  let hasMoreProjects: boolean | undefined = undefined;

  // Ministry View用
  let ministryTotalProjects: number | undefined = undefined;

  if (targetRecipientName) {
    // --- Spending View (Reverse Flow) ---
    // 1. Find Recipient
    // Note: Since we don't have a direct recipient lookup, we search in spendings
    // This might be slow if not optimized, but for now we iterate.
    // A better way would be to have a recipient map in structured data, but we work with what we have.
    // We look for spendings matching the name.
    const recipientSpendings = data.spendings.filter(s => s.spendingName === targetRecipientName);

    if (recipientSpendings.length === 0) {
      // It might be "その他" or aggregated, but usually we target specific named recipient
      // If not found, return empty
    } else {
      // In Spending View, "topSpendings" will contain just the target recipient (aggregated or single)
      // Actually, the recipient node is the root.
      // We need to find which projects paid to this recipient.

      // Aggregate all spending records for this recipient name (in case of multiple IDs for same name, though unlikely for unique ID)
      // Assuming targetRecipientName corresponds to a unique entity logic we want to show.
      topSpendings = recipientSpendings;

      // 2. Find Projects that paid to this recipient
      // We need to collect all project IDs from these spending records
      const contributingProjectIds = new Set<number>();
      const amountByProject = new Map<number, number>();

      for (const s of recipientSpendings) {
        for (const p of s.projects) {
          contributingProjectIds.add(p.projectId);
          const current = amountByProject.get(p.projectId) || 0;
          amountByProject.set(p.projectId, current + p.amount);
        }
      }

      // Get full project details
      const allContributingProjects = data.budgets.filter(b => contributingProjectIds.has(b.projectId));

      // Sort projects by amount contributed to this recipient
      const sortedProjects = allContributingProjects.sort((a, b) => {
        return (amountByProject.get(b.projectId) || 0) - (amountByProject.get(a.projectId) || 0);
      });

      // Take Top N Projects (with pagination support via projectOffset)
      const candidateTopProjects = sortedProjects.slice(projectOffset, projectOffset + projectLimit);

      // 2.5. Calculate ministry spending to determine TopN ministries
      const allMinistrySpending = new Map<string, number>();

      for (const project of sortedProjects) {
        const amount = amountByProject.get(project.projectId) || 0;
        const current = allMinistrySpending.get(project.ministry) || 0;
        allMinistrySpending.set(project.ministry, current + amount);
      }

      // Sort ministries by spending and select TopN
      const sortedMinistries = Array.from(allMinistrySpending.entries())
        .sort((a, b) => b[1] - a[1]);

      const topMinistryNames = new Set(sortedMinistries.slice(0, limit).map(([name]) => name));

      // 3. Filter topProjects to only include projects from TopN ministries
      topProjects = candidateTopProjects.filter(p => topMinistryNames.has(p.ministry));

      // TopN府省庁内のTopN以外事業の金額を集計
      // (projectOffset前 + projectOffset+projectLimit以降のTopN府省庁の事業)
      let otherProjectsAmount = 0;
      const otherProjectsByMinistry = new Map<string, number>();

      // projectOffset前のプロジェクト（前ページ）
      for (let i = 0; i < projectOffset; i++) {
        if (i < sortedProjects.length) {
          const project = sortedProjects[i];
          const projectId = project.projectId;
          const amount = amountByProject.get(projectId) || 0;

          // Only add to "Other" if from TopN ministries
          if (topMinistryNames.has(project.ministry)) {
            otherProjectsAmount += amount;
            const currentMinistryAmount = otherProjectsByMinistry.get(project.ministry) || 0;
            otherProjectsByMinistry.set(project.ministry, currentMinistryAmount + amount);
          }
        }
      }

      // projectOffset + projectLimit以降のプロジェクト（後ページ）
      for (let i = projectOffset + projectLimit; i < sortedProjects.length; i++) {
        const project = sortedProjects[i];
        const projectId = project.projectId;
        const amount = amountByProject.get(projectId) || 0;

        // Only add to "Other" if from TopN ministries
        if (topMinistryNames.has(project.ministry)) {
          otherProjectsAmount += amount;
          const currentMinistryAmount = otherProjectsByMinistry.get(project.ministry) || 0;
          otherProjectsByMinistry.set(project.ministry, currentMinistryAmount + amount);
        }
      }

      // NOTE: candidateTopProjects内のTopN以外府省庁の事業は、
      // nonTopMinistrySpendingに既に含まれているため、ここでは処理しない

      // Calculate spending from non-TopN ministries
      let nonTopMinistrySpending = 0;
      for (let i = limit; i < sortedMinistries.length; i++) {
        nonTopMinistrySpending += sortedMinistries[i][1];
      }

      // DataSelectionに追加情報を保存
      if (otherProjectsAmount > 0) {
        otherProjectsSpendingInSpendingView = otherProjectsAmount;
        otherProjectsSpendingByMinistryInSpendingView = otherProjectsByMinistry;
      }
      if (nonTopMinistrySpending > 0) {
        otherMinistriesSpendingInSpendingView = nonTopMinistrySpending;
      }
      hasMoreProjects = sortedProjects.length > projectOffset + projectLimit;

      // 4. Build topMinistries list
      topMinistries = data.budgetTree.ministries
        .filter(m => topMinistryNames.has(m.name))
        .map(m => ({
          name: m.name,
          id: m.id,
          totalBudget: m.totalBudget,
          bureauCount: m.bureaus.length
        }));
    }

  } else if (targetProjectName) {
    // --- Project View ---
    // 1. Find Project
    const project = data.budgets.find(b => b.projectName === targetProjectName);
    if (!project) {
      throw new Error(`Project not found: ${targetProjectName}`);
    }
    topProjects = [project];

    // 2. Find Ministry
    const ministry = data.budgetTree.ministries.find(m => m.name === project.ministry);
    if (ministry) {
      topMinistries = [{
        name: ministry.name,
        id: ministry.id,
        totalBudget: ministry.totalBudget,
        bureauCount: ministry.bureaus.length,
      }];
    }

    // 3. Find Spendings for this project
    // Logic similar to standard view but focused on one project
    // We will populate topSpendings below using the standard logic but applied to this single project

  } else if (targetMinistryName) {
    // --- Ministry View ---
    const ministry = data.budgetTree.ministries.find(m => m.name === targetMinistryName);
    if (!ministry) {
      throw new Error(`Ministry not found: ${targetMinistryName}`);
    }
    topMinistries = [{
      name: ministry.name,
      id: ministry.id,
      totalBudget: ministry.totalBudget,
      bureauCount: ministry.bureaus.length,
    }];

    // NOTE: Project selection is deferred until after spending TopN selection
    // (see below in Ministry View Independent TopN Selection section)

  } else {
    // --- Global View ---
    // IMPORTANT: Select ministries FIRST, then filter projects and spendings based on selected ministries

    // 1. Select TopN ministries (not all ministries)
    const allMinistries = data.budgetTree.ministries
      .sort((a, b) => b.totalBudget - a.totalBudget);

    if (drilldownLevel > 0) {
      // Drilldown mode: show ministries EXCLUDING previously shown TopN
      // Level 1: Exclude Top10, show Top11-20
      // Level 2: Exclude Top10 & Top11-20, show Top21-30
      const excludeCount = limit * drilldownLevel;
      const excludedMinistries = allMinistries.slice(0, excludeCount);
      const remainingMinistries = allMinistries.slice(excludeCount);

      // Take next 'limit' ministries from remainingMinistries (offset is already applied via excludeCount)
      topMinistries = remainingMinistries.slice(0, limit).map(m => ({
        name: m.name,
        id: m.id,
        totalBudget: m.totalBudget,
        bureauCount: m.bureaus.length,
      }));

      // "Other Ministries" in this mode only includes ministries beyond current page
      // (not the original excluded TopN)
      const afterPage = remainingMinistries.slice(limit);
      otherMinistriesBudget = afterPage.reduce((sum, m) => sum + m.totalBudget, 0);

      // Calculate spending for "other" (only afterPage)
      for (const ministry of afterPage) {
        const ministryStats = data.statistics.byMinistry[ministry.name];
        if (ministryStats) {
          otherMinistriesSpending += ministryStats.totalSpending;
        }
      }
    } else {
      // Normal mode: show TopN ministries
      // Use 'limit' parameter for ministry selection (default: 3)
      topMinistries = allMinistries.slice(0, limit).map(m => ({
        name: m.name,
        id: m.id,
        totalBudget: m.totalBudget,
        bureauCount: m.bureaus.length,
      }));

      // Calculate "Other Ministries" budget and spending
      const otherMinistries = allMinistries.slice(limit);
      otherMinistriesBudget = otherMinistries.reduce((sum, m) => sum + m.totalBudget, 0);

      // Calculate other ministries spending
      for (const ministry of otherMinistries) {
        const ministryStats = data.statistics.byMinistry[ministry.name];
        if (ministryStats) {
          otherMinistriesSpending += ministryStats.totalSpending;
        }
      }
    }

    // 2. Filter projects to only those from selected ministries
    const selectedMinistryNames = new Set(topMinistries.map(m => m.name));
    const projectsFromSelectedMinistries = data.budgets.filter(b =>
      selectedMinistryNames.has(b.ministry)
    );

    // 3. Select Top N Recipients (excluding "その他") based on spending from selected ministries
    // Calculate spending per recipient from selected ministries only
    const recipientSpendingFromSelectedMinistries = new Map<number, number>();
    for (const spending of data.spendings) {
      if (spending.spendingName === 'その他') continue;

      let totalFromSelected = 0;
      for (const project of spending.projects) {
        const budgetRecord = projectsFromSelectedMinistries.find(b => b.projectId === project.projectId);
        if (budgetRecord) {
          totalFromSelected += project.amount;
        }
      }
      if (totalFromSelected > 0) {
        recipientSpendingFromSelectedMinistries.set(spending.spendingId, totalFromSelected);
      }
    }

    // Sort recipients by spending from selected ministries
    const allRecipients = data.spendings
      .filter(s => recipientSpendingFromSelectedMinistries.has(s.spendingId))
      .sort((a, b) => {
        const aSpending = recipientSpendingFromSelectedMinistries.get(a.spendingId) || 0;
        const bSpending = recipientSpendingFromSelectedMinistries.get(b.spendingId) || 0;
        return bSpending - aSpending;
      });

    const topRecipients = allRecipients.slice(0, spendingLimit);
    topSpendings = topRecipients;

    // 4. Find all projects that contribute to TopN recipients (from selected ministries)
    const topRecipientIds = new Set(topRecipients.map(r => r.spendingId));

    // Calculate each project's spending to top recipients
    const projectSpendingToTopRecipients = new Map<number, number>();
    for (const project of projectsFromSelectedMinistries) {
      let spendingToTop = 0;
      const projectSpendings = data.spendings.filter(s =>
        s.projects.some(p => p.projectId === project.projectId)
      );
      for (const spending of projectSpendings) {
        if (topRecipientIds.has(spending.spendingId)) {
          const projectContribution = spending.projects.find(p => p.projectId === project.projectId);
          if (projectContribution) {
            spendingToTop += projectContribution.amount;
          }
        }
      }
      if (spendingToTop > 0) {
        projectSpendingToTopRecipients.set(project.projectId, spendingToTop);
      }
    }

    // Select projects that contribute to TopN recipients, sorted by contribution
    const contributingProjects = projectsFromSelectedMinistries
      .filter(b => projectSpendingToTopRecipients.has(b.projectId))
      .sort((a, b) => {
        return (projectSpendingToTopRecipients.get(b.projectId) || 0) -
          (projectSpendingToTopRecipients.get(a.projectId) || 0);
      })
      .slice(0, spendingLimit); // Limit to Top N projects to match user expectation

    topProjects = contributingProjects;

    // Calculate "Other Projects" for Global View to ensure flow continuity
    for (const ministry of topMinistries) {
      const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);

      // Budget
      const usedBudget = ministryProjects.reduce((sum, p) => sum + p.totalBudget, 0);
      const otherBudget = ministry.totalBudget - usedBudget;
      if (otherBudget > 0) {
        otherProjectsBudgetByMinistry.set(ministry.name, otherBudget);
      }

      // Spending
      const ministryStats = data.statistics.byMinistry[ministry.name];
      const totalSpending = ministryStats ? ministryStats.totalSpending : 0;
      const usedSpending = ministryProjects.reduce((sum, p) => sum + p.totalSpendingAmount, 0);
      const otherSpending = totalSpending - usedSpending;

      if (otherSpending > 0) {
        otherProjectsSpendingByMinistry.set(ministry.name, otherSpending);
      }
    }
  }

  // --- Common Logic for Spendings (except for Spending View which is handled above) ---
  // In Global View, topSpendings is already selected globally.
  // In Ministry View, we need independent TopN selection for projects and spendings.
  // In Project View, we need to select top spendings for the single project.
  if (!targetRecipientName && (targetMinistryName || targetProjectName)) {
    // Aggregate "Other" named spendings
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
      }
    }

    if (targetMinistryName && !targetProjectName) {
      // --- Ministry View: Drilldown-aware TopN Selection ---
      // Step 1: Select Top Projects by budget amount FIRST
      const ministryProjects = data.budgets.filter(p => p.ministry === targetMinistryName);

      // Sort projects by budget amount (descending)
      const sortedProjects = ministryProjects
        .sort((a, b) => b.totalBudget - a.totalBudget);

      // Store total project count for ministry view UI
      ministryTotalProjects = sortedProjects.length;

      // Select projects based on projectOffset for pagination
      topProjects = sortedProjects
        .slice(projectOffset, projectOffset + projectLimit);

      // Calculate other projects budget (projects AFTER current page, not before)
      // projectOffset より前の事業は既に表示済みなので「その他」には含めない
      const otherBudget = sortedProjects
        .slice(projectOffset + projectLimit) // Only projects after current page
        .reduce((sum, project) => sum + project.totalBudget, 0);
      if (otherBudget > 0) {
        otherProjectsBudgetByMinistry.set(targetMinistryName, otherBudget);
      }

      // Calculate spending amount for "Other Projects" (only projects after current page)
      const otherSpending = sortedProjects
        .slice(projectOffset + projectLimit) // Only projects after current page
        .reduce((sum, project) => sum + project.totalSpendingAmount, 0);
      if (otherSpending > 0) {
        otherProjectsSpendingByMinistry.set(targetMinistryName, otherSpending);
      }

      // Step 2: Select Top Spendings from CURRENT PAGE projects only
      // Get only the project IDs from current page (topProjects)
      const currentPageProjectIds = topProjects.map(p => p.projectId);

      const currentPageSpendingMap = new Map<number, number>(); // spendingId -> total amount

      for (const spending of data.spendings) {
        if (spending.spendingName === 'その他') continue;

        let totalFromCurrentPage = 0;
        for (const proj of spending.projects) {
          if (currentPageProjectIds.includes(proj.projectId)) {
            totalFromCurrentPage += proj.amount;
          }
        }

        if (totalFromCurrentPage > 0) {
          currentPageSpendingMap.set(spending.spendingId, totalFromCurrentPage);
        }
      }

      // Sort and select TopN spendings from current page only
      const sortedSpendings = Array.from(currentPageSpendingMap.entries())
        .sort((a, b) => b[1] - a[1]);

      const topSpendingIds = new Set(
        sortedSpendings.slice(0, spendingLimit).map(([id]) => id)
      );

      topSpendings = data.spendings.filter(s => topSpendingIds.has(s.spendingId));

      // Step 3: Calculate "Other Spendings" per project
      // For each project in topProjects, calculate spending to non-TopN recipients
      for (const project of topProjects) {
        const projectSpendings = data.spendings
          .filter(s => project.spendingIds.includes(s.spendingId))
          .filter(s => s.spendingName !== 'その他');

        let otherSpendingTotal = 0;
        for (const spending of projectSpendings) {
          if (!topSpendingIds.has(spending.spendingId)) {
            const projectSpending = spending.projects.find(p => p.projectId === project.projectId);
            otherSpendingTotal += projectSpending?.amount || 0;
          }
        }

        if (otherSpendingTotal > 0) {
          otherSpendingsByProject.set(project.projectId, otherSpendingTotal);
        }
      }

    } else {
      // --- Project View: Select top spendings for the single project ---
      const topSpendingIds = new Set<number>();

      for (const project of topProjects) {
        const projectSpendings = data.spendings
          .filter(s => project.spendingIds.includes(s.spendingId))
          .filter(s => s.spendingName !== 'その他')
          .map(s => {
            const projectSpending = s.projects.find(p => p.projectId === project.projectId);
            return {
              spending: s,
              amountFromThisProject: projectSpending?.amount || 0,
            };
          });

        const sortedSpendings = projectSpendings.sort((a, b) => b.amountFromThisProject - a.amountFromThisProject);

        const topNSpendings = sortedSpendings.slice(0, spendingLimit);

        for (const { spending } of topNSpendings) {
          topSpendingIds.add(spending.spendingId);
        }

        const otherSpendingTotal = sortedSpendings
          .slice(spendingLimit)
          .reduce((sum, { amountFromThisProject }) => sum + amountFromThisProject, 0);

        if (otherSpendingTotal > 0) {
          otherSpendingsByProject.set(project.projectId, otherSpendingTotal);
        }
      }

      topSpendings = data.spendings.filter(s => topSpendingIds.has(s.spendingId));
    }
  }

  return {
    topMinistries,
    otherMinistriesBudget,
    otherMinistriesSpending,
    topProjects,
    otherProjectsBudgetByMinistry,
    otherProjectsSpendingByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject,
    otherProjectsSpendingInSpendingView,
    otherProjectsSpendingByMinistryInSpendingView,
    otherMinistriesSpendingInSpendingView,
    hasMoreProjects,
    ministryTotalProjects,
  };
}

function buildSankeyData(
  selection: DataSelection,
  fullData: RS2024StructuredData,
  options: {
    offset: number;
    targetMinistryName?: string;
    targetProjectName?: string;
    targetRecipientName?: string;
    ministryLimit: number;
    projectLimit: number;
    spendingLimit: number;
    drilldownLevel?: number;
  }
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const {
    topMinistries,
    otherMinistriesBudget,
    otherMinistriesSpending,
    topProjects,
    otherProjectsBudgetByMinistry,
    otherProjectsSpendingByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject,
    otherMinistriesSpendingInSpendingView,
  } = selection;

  const { offset, targetMinistryName, targetProjectName, targetRecipientName, ministryLimit, projectLimit, spendingLimit, drilldownLevel = 0 } = options;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // --- SPENDING VIEW (Reverse Flow with Budget) ---
  if (targetRecipientName) {
    // Column 3: Recipient (rightmost)
    const recipientNodeId = `recipient-root`;
    let totalRecipientValue = 0;

    // Column 2: Project Spending Nodes
    const projectSpendingNodes: SankeyNode[] = [];
    for (const project of topProjects) {
      // Find amount contributed by this project to the target recipient
      let amount = 0;
      for (const s of topSpendings) {
        const p = s.projects.find(p => p.projectId === project.projectId);
        if (p) amount += p.amount;
      }

      if (amount > 0) {
        totalRecipientValue += amount;

        projectSpendingNodes.push({
          id: `project-spending-${project.projectId}`,
          name: project.projectName,
          type: 'project-spending',
          value: amount,
          originalId: project.projectId,
          details: {
            ministry: project.ministry,
            bureau: project.bureau,
            fiscalYear: project.fiscalYear,
            executionRate: project.executionRate,
            spendingCount: project.spendingIds.length,
          }
        });

        // Link: Project Spending -> Recipient
        links.push({
          source: `project-spending-${project.projectId}`,
          target: recipientNodeId,
          value: amount
        });
      }
    }

    // Column 1: Project Budget Nodes
    const projectBudgetNodes: SankeyNode[] = [];
    for (const project of topProjects) {
      // Find spending amount for this project
      let spendingAmount = 0;
      for (const s of topSpendings) {
        const p = s.projects.find(p => p.projectId === project.projectId);
        if (p) spendingAmount += p.amount;
      }

      if (spendingAmount > 0) {
        projectBudgetNodes.push({
          id: `project-budget-${project.projectId}`,
          name: project.projectName,
          type: 'project-budget',
          value: project.totalBudget,
          originalId: project.projectId,
          details: {
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
          }
        });

        // Link: Project Budget -> Project Spending
        // Use min of budget and spending to avoid overflow
        const linkValue = Math.min(project.totalBudget, spendingAmount);
        links.push({
          source: `project-budget-${project.projectId}`,
          target: `project-spending-${project.projectId}`,
          value: linkValue > 0 ? linkValue : 0.001 // Dummy value if 0
        });
      }
    }

    // Column 0: Ministry Budget Nodes
    const ministryBudgetNodes: SankeyNode[] = [];
    for (const ministry of topMinistries) {
      // Sum up budget for this ministry's projects
      const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);
      let ministryBudget = 0;

      for (const p of ministryProjects) {
        ministryBudget += p.totalBudget;

        // Link: Ministry Budget -> Project Budget
        const linkValue = p.totalBudget > 0 ? p.totalBudget : 0.001;
        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: `project-budget-${p.projectId}`,
          value: linkValue
        });
      }

      // Always create ministry budget node (even if budget is 0)
      // This is needed for "Other Projects" links
      ministryBudgetNodes.push({
        id: `ministry-budget-${ministry.id}`,
        name: ministry.name,
        type: 'ministry-budget',
        value: ministryBudget > 0 ? ministryBudget : 0.001, // Use dummy value if 0
        originalId: ministry.id,
        details: {
          projectCount: ministryProjects.length,
          bureauCount: ministry.bureauCount
        }
      });
    }

    // Add nodes in order: recipient, project spending, project budget, ministry budget
    nodes.push({
      id: recipientNodeId,
      name: targetRecipientName,
      type: 'recipient',
      value: totalRecipientValue,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: topProjects.length,
      }
    });

    nodes.push(...projectSpendingNodes);
    nodes.push(...projectBudgetNodes);
    nodes.push(...ministryBudgetNodes);

    // 【新規追加】TopN府省庁からの「事業(TopN以外)」ノード
    const otherProjectsSpending = selection.otherProjectsSpendingInSpendingView || 0;
    const otherProjectsBudget = otherProjectsSpending; // Budget情報がないので支出額で代用

    if (otherProjectsSpending > 0) {
      // Column 1: 事業予算(TopN以外)ノード
      nodes.push({
        id: 'project-budget-other-spending-view',
        name: `事業(Top${projectLimit}以外)`,
        type: 'project-budget',
        value: otherProjectsBudget,
        details: {
          ministry: 'TopN府省庁',
          bureau: '',
          fiscalYear: 2024,
          initialBudget: 0,
          supplementaryBudget: 0,
          carryoverBudget: 0,
          reserveFund: 0,
          totalBudget: 0,
          executedAmount: 0,
          carryoverToNext: 0,
          accountCategory: '',
        },
      });

      // Column 2: 事業支出(TopN以外)ノード
      nodes.push({
        id: 'project-spending-other-spending-view',
        name: `事業(Top${projectLimit}以外)`,
        type: 'project-spending',
        value: otherProjectsSpending,
        details: {
          ministry: 'TopN府省庁',
          bureau: '',
          fiscalYear: 2024,
          executionRate: 0,
          spendingCount: 0,
        },
      });

      // リンク: TopN府省庁予算 → 事業予算(TopN以外)
      if (selection.otherProjectsSpendingByMinistryInSpendingView) {
        for (const [ministryName, amount] of selection.otherProjectsSpendingByMinistryInSpendingView.entries()) {
          const ministry = topMinistries.find(m => m.name === ministryName);
          if (ministry && amount > 0) {
            links.push({
              source: `ministry-budget-${ministry.id}`,
              target: 'project-budget-other-spending-view',
              value: amount,
            });
          }
        }
      }

      // リンク: 事業予算(TopN以外) → 事業支出(TopN以外)
      links.push({
        source: 'project-budget-other-spending-view',
        target: 'project-spending-other-spending-view',
        value: otherProjectsSpending,
      });

      // リンク: 事業支出(TopN以外) → 受給者
      links.push({
        source: 'project-spending-other-spending-view',
        target: recipientNodeId,
        value: otherProjectsSpending,
      });
    }

    // 【新規追加】TopN以外の府省庁からの「府省庁(TopN以外)」ノード
    const otherMinistriesSpending = otherMinistriesSpendingInSpendingView || 0;

    if (otherMinistriesSpending > 0) {
      // Column 0: 府省庁予算(TopN以外)ノード
      nodes.push({
        id: 'ministry-budget-other-spending-view',
        name: `府省庁(Top${ministryLimit}以外)`,
        type: 'ministry-budget',
        value: otherMinistriesSpending,
        details: {
          projectCount: 0,
          bureauCount: 0,
        },
      });

      // Column 1: 事業予算(TopN以外・府省庁)ノード
      nodes.push({
        id: 'project-budget-other-ministry-spending-view',
        name: `事業(Top${ministryLimit}以外府省庁)`,
        type: 'project-budget',
        value: otherMinistriesSpending,
        details: {
          ministry: 'TopN以外府省庁',
          bureau: '',
          fiscalYear: 2024,
          initialBudget: 0,
          supplementaryBudget: 0,
          carryoverBudget: 0,
          reserveFund: 0,
          totalBudget: 0,
          executedAmount: 0,
          carryoverToNext: 0,
          accountCategory: '',
        },
      });

      // Column 2: 事業支出(TopN以外・府省庁)ノード
      nodes.push({
        id: 'project-spending-other-ministry-spending-view',
        name: `事業(Top${ministryLimit}以外府省庁)`,
        type: 'project-spending',
        value: otherMinistriesSpending,
        details: {
          ministry: 'TopN以外府省庁',
          bureau: '',
          fiscalYear: 2024,
          executionRate: 0,
          spendingCount: 0,
        },
      });

      // リンク: 府省庁予算(TopN以外) → 事業予算(TopN以外・府省庁)
      links.push({
        source: 'ministry-budget-other-spending-view',
        target: 'project-budget-other-ministry-spending-view',
        value: otherMinistriesSpending,
      });

      // リンク: 事業予算(TopN以外・府省庁) → 事業支出(TopN以外・府省庁)
      links.push({
        source: 'project-budget-other-ministry-spending-view',
        target: 'project-spending-other-ministry-spending-view',
        value: otherMinistriesSpending,
      });

      // リンク: 事業支出(TopN以外・府省庁) → 受給者
      links.push({
        source: 'project-spending-other-ministry-spending-view',
        target: recipientNodeId,
        value: otherMinistriesSpending,
      });
    }

    return { nodes, links };
  }

  // --- STANDARD VIEWS (Global, Ministry, Project) ---

  // Determine view type early for conditional logic
  const isGlobalView = !targetMinistryName && !targetProjectName && !targetRecipientName;

  // Column 0: Total Budget (Global View only) or Ministry Name (Project View only)
  // Ministry View: No Column 0 node (starts from Column 1: Ministry)
  if (!targetMinistryName) {
    const totalBudget = topMinistries.reduce((sum, m) => sum + m.totalBudget, 0) + otherMinistriesBudget;

    // Determine the label based on view mode
    let nodeName: string;
    if (targetProjectName && topMinistries.length === 1) {
      // Project View: use ministry name
      nodeName = topMinistries[0].name;
    } else {
      // Global View: use "予算総計"
      nodeName = offset === 0 ? '予算総計' : `予算総計 (Rank ${offset + 1}+)`;
    }

    nodes.push({
      id: 'total-budget',
      name: nodeName,
      type: 'ministry-budget',
      value: totalBudget,
      details: {
        projectCount: topProjects.length,
        bureauCount: topMinistries.reduce((sum, m) => sum + m.bureauCount, 0),
      },
    });

    // Link: Total -> Ministry (Global View only)
    if (!targetProjectName) {
      for (const ministry of topMinistries) {
        // In Ministry View, link value should match ministry node value (sum of selected projects)
        // In Global View, use ministry's total budget
        let linkValue = targetMinistryName
          ? topProjects.filter(p => p.ministry === ministry.name).reduce((sum, p) => sum + p.totalBudget, 0)
          : ministry.totalBudget;

        // Use dummy value if linkValue is 0 to ensure proper layout
        if (linkValue === 0 && targetMinistryName) {
          linkValue = 0.001;
        }

        links.push({
          source: 'total-budget',
          target: `ministry-budget-${ministry.id}`,
          value: linkValue,
        });
      }
      if (otherMinistriesBudget > 0) {
        links.push({
          source: 'total-budget',
          target: 'ministry-budget-other',
          value: otherMinistriesBudget,
        });
      }
      // Note: Return nodes do NOT receive links from total-budget
      // They are positioned in Column 0 (same as total-budget)
      // by only having outgoing links to ministry nodes
    }
    // Note: In Project View, Total -> Project Budget links are created in the Project Budget section
  }

  // Column 1: Ministry Nodes (Not shown in Project View)
  const standardMinistryNodes: SankeyNode[] = [];

  // Skip ministry nodes in Project View to avoid 0-yen ghost nodes
  if (!targetProjectName) {
    for (const ministry of topMinistries) {
      const projectCount = topProjects.filter(p => p.ministry === ministry.name).length;

      // In Ministry View, use the sum of selected projects' budgets
      // In Global View, use ministry's total budget
      let ministryValue = targetMinistryName
        ? topProjects.filter(p => p.ministry === ministry.name).reduce((sum, p) => sum + p.totalBudget, 0)
        : ministry.totalBudget;

      // Use dummy value if ministryValue is 0 to ensure proper layout
      const useDummyValue = ministryValue === 0 && targetMinistryName;
      if (useDummyValue) {
        ministryValue = 0.001;
      }

      standardMinistryNodes.push({
        id: `ministry-budget-${ministry.id}`,
        name: `${ministry.name}`,
        type: 'ministry-budget',
        value: ministryValue,
        originalId: ministry.id,
        details: {
          projectCount: projectCount,
          bureauCount: ministry.bureauCount,
        },
      });
    }

    // Add "Other Ministries" node if applicable (Global View only)
    if (isGlobalView && otherMinistriesBudget > 0) {
      // Calculate the TopN threshold based on drilldownLevel
      // Level 0: Top10以外 (ministries 11+)
      // Level 1: Top20以外 (ministries 21+)
      // Level 2: Top30以外 (ministries 31+)
      const currentTopN = ministryLimit * (drilldownLevel + 1);
      standardMinistryNodes.push({
        id: 'ministry-budget-other',
        name: `府省庁(Top${currentTopN}以外)`,
        type: 'ministry-budget',
        value: otherMinistriesBudget,
        details: {
          projectCount: 0,
          bureauCount: 0,
        },
      });
    }

    // "Return to TopN" nodes removed - now rendered as external UI buttons

    nodes.push(...standardMinistryNodes);
  }

  // Column 2: Project Budget Nodes
  const projectBudgetNodes: SankeyNode[] = [];

  // Create budget nodes for all projects in topProjects
  for (const project of topProjects) {
    // Use dummy value 0.001 if budget is 0 but spending exists
    const budgetNodeValue = project.totalBudget === 0 && project.totalSpendingAmount > 0
      ? 0.001
      : project.totalBudget;

    projectBudgetNodes.push({
      id: `project-budget-${project.projectId}`,
      name: project.projectName,
      type: 'project-budget',
      value: budgetNodeValue,
      originalId: project.projectId,
      details: {
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
      },
    });

    // Link: Ministry -> Project Budget (Global & Ministry View only)
    // In Project View, Total Budget links directly to Project Budget
    if (!targetProjectName) {
      // Use dummy value 0.001 if budget is 0 but spending exists
      const linkValue = project.totalBudget === 0 && project.totalSpendingAmount > 0
        ? 0.001
        : project.totalBudget;

      // Find ministry ID from topMinistries or full data
      const ministry = topMinistries.find(m => m.name === project.ministry);
      if (ministry) {
        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: `project-budget-${project.projectId}`,
          value: linkValue,
        });
      } else if (isGlobalView && otherMinistriesBudget > 0) {
        // In Global View, link projects from non-TopN ministries to "その他の府省庁"
        links.push({
          source: 'ministry-budget-other',
          target: `project-budget-${project.projectId}`,
          value: linkValue,
        });
      }
    } else {
      // Project View: Total Budget -> Project Budget
      const linkValue = project.totalBudget === 0 && project.totalSpendingAmount > 0
        ? 0.001
        : project.totalBudget;

      links.push({
        source: 'total-budget',
        target: `project-budget-${project.projectId}`,
        value: linkValue,
      });
    }
  }

  // Create "Other Projects" budget nodes (non-Global View only)
  if (!isGlobalView) {
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherBudget && otherBudget > 0 && !targetProjectName) {
        projectBudgetNodes.push({
          id: `project-budget-other-${ministry.id}`,
          name: `事業(Top${projectLimit}以外)`,
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

        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: `project-budget-other-${ministry.id}`,
          value: otherBudget,
        });
      }
    }
  }

  // Global View: Create single "Other Projects" budget node and links
  if (isGlobalView) {
    let totalOtherBudget = 0;

    // Links from topMinistries to "Other Projects"
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherBudget && otherBudget > 0) {
        totalOtherBudget += otherBudget;
        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: 'project-budget-other-global',
          value: otherBudget,
        });
      }
    }

    // Link from "Other Ministries" to "Other Projects" (always use shared node)
    if (otherMinistriesBudget > 0) {
      totalOtherBudget += otherMinistriesBudget;
      links.push({
        source: 'ministry-budget-other',
        target: 'project-budget-other-global',
        value: otherMinistriesBudget,
      });
    }

    // Link from "Return to TopN" nodes now goes to dummy recipient nodes
    // (See recipient node creation section below)

    if (totalOtherBudget > 0) {
      projectBudgetNodes.push({
        id: 'project-budget-other-global',
        name: `事業(Top${spendingLimit}以外)`,
        type: 'project-budget',
        value: totalOtherBudget,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          initialBudget: totalOtherBudget,
          supplementaryBudget: 0,
          carryoverBudget: 0,
          reserveFund: 0,
          totalBudget: totalOtherBudget,
          executedAmount: 0,
          carryoverToNext: 0,
          accountCategory: '',
        },
      });
    }
  }
  nodes.push(...projectBudgetNodes);

  // Column 3: Project Spending Nodes
  const projectSpendingNodes: SankeyNode[] = [];

  // Track projects with 0 spending IDs for "支出先なし" node
  const projectsWithNoSpending: BudgetRecord[] = [];

  // Create spending nodes for all projects in topProjects
  for (const project of topProjects) {
    // Track projects with 0 spending IDs
    if (project.spendingIds.length === 0) {
      projectsWithNoSpending.push(project);
      continue;
    }

    projectSpendingNodes.push({
      id: `project-spending-${project.projectId}`,
      name: project.projectName,
      type: 'project-spending',
      value: project.totalSpendingAmount,
      originalId: project.projectId,
      details: {
        ministry: project.ministry,
        bureau: project.bureau,
        fiscalYear: project.fiscalYear,
        executionRate: project.executionRate,
        spendingCount: project.spendingIds.length,
      },
    });

    // Use dummy value 0.001 if budget is 0 but spending exists
    let linkValue = Math.min(project.totalBudget, project.totalSpendingAmount);
    if (project.totalBudget === 0 && project.totalSpendingAmount > 0) {
      linkValue = 0.001;
    }

    links.push({
      source: `project-budget-${project.projectId}`,
      target: `project-spending-${project.projectId}`,
      value: linkValue,
    });
  }

  // Create "Other Projects" spending nodes (non-Global View only)
  if (!isGlobalView) {
    for (const ministry of topMinistries) {
      const otherSpending = otherProjectsSpendingByMinistry.get(ministry.name) || 0;
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name) || 0;

      // budgetノードが存在する場合は、spendingノードも必ず作成する
      if (otherBudget > 0 && !targetProjectName) {
        projectSpendingNodes.push({
          id: `project-spending-other-${ministry.id}`,
          name: `事業(Top${projectLimit}以外)`,
          type: 'project-spending',
          value: otherSpending,
          details: {
            ministry: ministry.name,
            bureau: '',
            fiscalYear: 2024,
            executionRate: 0,
            spendingCount: 0,
          },
        });

        // Link from budget-side to spending-side "Other Projects"
        // Use dummy value 0.001 if budget exists but spending is 0
        let linkValue = Math.min(otherBudget, otherSpending);
        if (linkValue === 0 && otherBudget > 0) {
          linkValue = 0.001;
        }
        links.push({
          source: `project-budget-other-${ministry.id}`,
          target: `project-spending-other-${ministry.id}`,
          value: linkValue,
        });
      }
    }
  }

  // Global View: Create single "Other Projects" spending node
  if (isGlobalView) {
    let totalOtherSpending = 0;
    let totalOtherBudget = 0; // Need this for link calculation

    // Aggregate from topMinistries
    for (const ministry of topMinistries) {
      const otherSpending = otherProjectsSpendingByMinistry.get(ministry.name);
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherSpending) totalOtherSpending += otherSpending;
      if (otherBudget) totalOtherBudget += otherBudget;
    }

    // Add "Other Ministries" spending (always include)
    totalOtherSpending += otherMinistriesSpending;
    totalOtherBudget += otherMinistriesBudget;

    if (totalOtherSpending > 0) {
      projectSpendingNodes.push({
        id: 'project-spending-other-global',
        name: `事業(Top${spendingLimit}以外)`,
        type: 'project-spending',
        value: totalOtherSpending,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          executionRate: 0,
          spendingCount: 0,
        },
      });

      // Link from budget-side to spending-side "Other Projects"
      // In global view, we link the global nodes
      const linkValue = Math.min(totalOtherBudget, totalOtherSpending);
      if (linkValue > 0) {
        links.push({
          source: 'project-budget-other-global',
          target: 'project-spending-other-global',
          value: linkValue,
        });
      }
    }
  }
  nodes.push(...projectSpendingNodes);

  // Column 4: Recipient Nodes
  const recipientNodes: SankeyNode[] = [];

  if (isGlobalView) {
    // Global View: Create nodes for all topSpendings and links from their projects
    for (const spending of topSpendings) {
      // Calculate spending amount from selected TopN projects only
      let spendingFromSelectedProjects = 0;
      for (const spendingProject of spending.projects) {
        // Only count spending from topProjects (selected TopN projects)
        const projectExists = topProjects.some(p => p.projectId === spendingProject.projectId);
        if (projectExists) {
          spendingFromSelectedProjects += spendingProject.amount;
        }
      }

      // Create recipient node with spending from selected projects only
      recipientNodes.push({
        id: `recipient-${spending.spendingId}`,
        name: spending.spendingName,
        type: 'recipient',
        value: spendingFromSelectedProjects,
        originalId: spending.spendingId,
        details: {
          corporateNumber: spending.corporateNumber,
          location: spending.location,
          projectCount: spending.projectCount,
        },
      });

      // Create links from all projects that contribute to this spending
      for (const spendingProject of spending.projects) {
        // Check if this project's spending node exists (i.e., it's in topProjects)
        const projectExists = topProjects.some(p => p.projectId === spendingProject.projectId);
        if (projectExists) {
          links.push({
            source: `project-spending-${spendingProject.projectId}`,
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
  } else {
    // Ministry/Project View: Calculate spending from selected projects only
    // First pass: calculate spending amounts for each recipient
    const recipientSpendingAmounts = new Map<number, number>();
    for (const project of topProjects) {
      for (const spending of topSpendings) {
        const spendingProject = spending.projects.find(p => p.projectId === project.projectId);
        if (spendingProject) {
          const currentAmount = recipientSpendingAmounts.get(spending.spendingId) || 0;
          recipientSpendingAmounts.set(spending.spendingId, currentAmount + spendingProject.amount);
        }
      }
    }

    // Second pass: create nodes and links
    for (const project of topProjects) {
      for (const spending of topSpendings) {
        const spendingProject = spending.projects.find(p => p.projectId === project.projectId);
        if (spendingProject) {
          if (!recipientNodes.some(n => n.id === `recipient-${spending.spendingId}`)) {
            const spendingFromSelectedProjects = recipientSpendingAmounts.get(spending.spendingId) || 0;
            recipientNodes.push({
              id: `recipient-${spending.spendingId}`,
              name: spending.spendingName,
              type: 'recipient',
              value: spendingFromSelectedProjects,
              originalId: spending.spendingId,
              details: {
                corporateNumber: spending.corporateNumber,
                location: spending.location,
                projectCount: spending.projectCount,
              },
            });
          }

          // Use dummy value 0.001 if amount is 0 to prevent broken links
          const linkValue = spendingProject.amount === 0 ? 0.001 : spendingProject.amount;

          links.push({
            source: `project-spending-${project.projectId}`,
            target: `recipient-${spending.spendingId}`,
            value: linkValue,
            details: {
              contractMethod: spendingProject.contractMethod,
              blockName: spendingProject.blockName,
            },
          });
        }
      }
    }
  }


  // "Other Named" (その他)
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

    const topProjectIds = new Set(topProjects.map(p => p.projectId));
    for (const [projectId, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
      if (topProjectIds.has(projectId)) {
        // Use dummy value 0.001 if amount is 0 to prevent broken links
        const linkValue = otherNamedAmount === 0 ? 0.001 : otherNamedAmount;
        if (linkValue > 0) {
          links.push({
            source: `project-spending-${projectId}`,
            target: 'recipient-other-named',
            value: linkValue,
          });
        }
      }
    }

    // Links from "Other Projects" to "Other Named" - only in Ministry/Project views, NOT in Global View
    if (!targetProjectName && !targetRecipientName && !isGlobalView) {
      const { byMinistryId: otherProjectsOtherNamedByMinistryId } =
        calculateOtherProjectsOtherNamedByMinistry(topMinistries, topProjects, otherNamedSpendingByProject, fullData);

      for (const [ministryId, amount] of otherProjectsOtherNamedByMinistryId.entries()) {
        // Only create link if "Other Projects" spending node exists
        const otherProjectsSpendingNodeExists = nodes.some(n => n.id === `project-spending-other-${ministryId}`);
        if (otherProjectsSpendingNodeExists) {
          links.push({
            source: `project-spending-other-${ministryId}`,
            target: 'recipient-other-named',
            value: amount,
          });
        }
      }
    }
  }

  // Links from "Other Projects" to TopN Recipients (Ministry View only)
  if (!isGlobalView && !targetProjectName && !targetRecipientName) {
    // Calculate spending from "Other Projects" (projects not in current page) to each TopN recipient
    for (const ministry of topMinistries) {
      const topProjectIds = new Set(topProjects.filter(p => p.ministry === ministry.name).map(p => p.projectId));
      const allMinistryProjects = fullData.budgets.filter(b => b.ministry === ministry.name);

      // Sort projects by budget to get the correct offset-based filtering
      const sortedMinistryProjects = allMinistryProjects.sort((a, b) => b.totalBudget - a.totalBudget);

      // For Ministry View, "Other Projects" = projects AFTER current page (offset + limit)
      // We need to calculate the current offset from topProjects
      const currentPageStart = sortedMinistryProjects.findIndex(p => topProjectIds.has(p.projectId));
      const currentPageEnd = currentPageStart + topProjectIds.size;

      // Only include projects after current page
      const otherProjects = sortedMinistryProjects.slice(currentPageEnd);

      // For each TopN recipient, calculate total spending from "Other Projects"
      const topSpendingIds = new Set(topSpendings.map(s => s.spendingId));

      for (const spending of topSpendings) {
        let amountFromOtherProjects = 0;

        for (const otherProject of otherProjects) {
          const spendingProject = spending.projects.find(p => p.projectId === otherProject.projectId);
          if (spendingProject) {
            amountFromOtherProjects += spendingProject.amount;
          }
        }

        // Create link from "Other Projects" to this recipient only if recipient node exists
        // Recipient nodes are created in line 1463-1498 only for topSpendings from topProjects
        // So we need to check if this spending appears in any topProject
        const recipientHasNodeFromTopProjects = topProjects.some(p =>
          spending.projects.some(sp => sp.projectId === p.projectId)
        );

        // Only create link if "Other Projects" spending node exists
        const otherProjectsSpendingNodeExists = nodes.some(n => n.id === `project-spending-other-${ministry.id}`);
        if (amountFromOtherProjects > 0 && recipientHasNodeFromTopProjects && otherProjectsSpendingNodeExists) {
          links.push({
            source: `project-spending-other-${ministry.id}`,
            target: `recipient-${spending.spendingId}`,
            value: amountFromOtherProjects,
          });
        }
      }
    }
  }

  // Helper functions for calculating "Other" amounts
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

  // Aggregated "Other Recipient" Node (for TopN cutoff)
  let totalOtherRecipientAmount = 0;

  if (isGlobalView) {
    // --- Global View: Calculate "支出先(TopN以外)" ---
    // 1. Flow from "Other Projects" (Global Aggregated Node)
    // We assume all "Other Projects" spending goes to "Other Recipients"
    const otherProjectsSpendingNode = nodes.find(n => n.id === 'project-spending-other-global');
    if (otherProjectsSpendingNode) {
      totalOtherRecipientAmount += otherProjectsSpendingNode.value;
    }

    // 2. Flow from "Top Projects" remainder
    // Calculate total spending of Top Projects minus what went to Top Recipients
    const topRecipientIds = new Set(topSpendings.map(s => s.spendingId));

    for (const project of topProjects) {
      let projectTotalToOthers = 0;

      // Find all recipients for this project
      for (const spendingId of project.spendingIds) {
        const spending = fullData.spendings.find(s => s.spendingId === spendingId);
        if (!spending) continue;

        // Skip topN recipients and "その他"
        if (topRecipientIds.has(spendingId) || spending.spendingName === 'その他') continue;

        // This is an "other recipient"
        const spendingProject = spending.projects.find(p => p.projectId === project.projectId);
        if (spendingProject) {
          projectTotalToOthers += spendingProject.amount;
        }
      }

      if (projectTotalToOthers > 0) {
        totalOtherRecipientAmount += projectTotalToOthers;
        // Store for later linking
        otherSpendingsByProject.set(project.projectId, projectTotalToOthers);
      }
    }
  } else {
    // --- Ministry/Project/Spending Views: Original logic ---
    // Calculate amounts for "Other Projects" -> "Other Recipients"
    const otherProjectsOtherNamedByMinistryNameForRecipient =
      totalOtherNamedAmount > 0 && !targetProjectName && !targetRecipientName
        ? calculateOtherProjectsOtherNamedByMinistry(topMinistries, topProjects, otherNamedSpendingByProject, fullData).byMinistryName
        : new Map<string, number>();

    // Calculate total for "Other Recipients" node
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name) || 0;
      const otherNamedAmount = otherProjectsOtherNamedByMinistryNameForRecipient.get(ministry.name) || 0;
      const adjustedBudget = otherBudget - otherNamedAmount;
      if (adjustedBudget > 0) {
        totalOtherRecipientAmount += adjustedBudget;
      }
    }

    // Calculate total "Other Recipients" amount from "Other Projects" only
    for (const [, otherAmount] of otherSpendingsByProject.entries()) {
      totalOtherRecipientAmount += otherAmount;
    }
  }

  if (totalOtherRecipientAmount > 0) {
    recipientNodes.push({
      id: 'recipient-other-aggregated',
      name: `支出先(Top${spendingLimit}以外)`,
      type: 'recipient',
      value: totalOtherRecipientAmount,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: 0,
      },
    });

    if (isGlobalView) {
      // --- Global View: Links ---

      const otherProjectsSpendingNode = nodes.find(n => n.id === 'project-spending-other-global');
      let otherProjectsValueUsed = 0;

      // 1. Links from "Other Projects" (Global) to Top Recipients
      // If Top Projects don't cover the full amount of a Top Recipient FROM SELECTED MINISTRIES,
      // the rest comes from "Other Projects"
      for (const recipient of topSpendings) {
        // Calculate how much this recipient got from Top Projects (already calculated)
        let receivedFromTopProjects = 0;
        for (const project of topProjects) {
          const p = recipient.projects.find(rp => rp.projectId === project.projectId);
          if (p) receivedFromTopProjects += p.amount;
        }

        // Calculate total spending from selected ministries only (not all ministries)
        const selectedMinistryNames = new Set(topMinistries.map(m => m.name));
        let totalFromSelectedMinistries = 0;
        for (const spendingProject of recipient.projects) {
          // Only count if project is from selected ministries
          const projectInData = fullData.budgets.find((b: { projectId: number; ministry: string }) => b.projectId === spendingProject.projectId);
          if (projectInData && selectedMinistryNames.has(projectInData.ministry)) {
            totalFromSelectedMinistries += spendingProject.amount;
          }
        }

        const remainder = totalFromSelectedMinistries - receivedFromTopProjects;
        if (remainder > 0 && otherProjectsSpendingNode) {
          links.push({
            source: 'project-spending-other-global',
            target: `recipient-${recipient.spendingId}`,
            value: remainder,
          });
          otherProjectsValueUsed += remainder;
        }
      }

      // 2. Link from "Other Projects" (Global) to "Other Recipients"
      // The remaining value of "Other Projects" goes to "Other Recipients"
      if (otherProjectsSpendingNode) {
        const remainingValue = otherProjectsSpendingNode.value - otherProjectsValueUsed;
        if (remainingValue > 0) {
          links.push({
            source: 'project-spending-other-global',
            target: 'recipient-other-aggregated',
            value: remainingValue,
          });
        }
      }

      // 3. Links from Top Projects to "Other Recipients"
      for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
        // Use dummy value 0.001 if amount is 0 to prevent broken links
        const linkValue = otherAmount === 0 ? 0.001 : otherAmount;
        if (linkValue > 0) {
          links.push({
            source: `project-spending-${projectId}`,
            target: 'recipient-other-aggregated',
            value: linkValue,
          });
        }
      }
    } else {
      // --- Ministry/Project/Spending Views: Original logic ---
      // Links from "Other Projects" to "Other Recipients"
      // Note: Links to TopN recipients are handled separately above (line 1551-1580)
      if (!targetProjectName && !targetRecipientName) {
        for (const ministry of topMinistries) {
          // Calculate spending from "Other Projects" to non-TopN recipients only
          const topProjectIds = new Set(topProjects.filter(p => p.ministry === ministry.name).map(p => p.projectId));
          const allMinistryProjects = fullData.budgets.filter(b => b.ministry === ministry.name);

          // Sort projects by budget to get the correct offset-based filtering
          const sortedMinistryProjects = allMinistryProjects.sort((a, b) => b.totalBudget - a.totalBudget);

          // For Ministry View, "Other Projects" = projects AFTER current page (offset + limit)
          const currentPageStart = sortedMinistryProjects.findIndex(p => topProjectIds.has(p.projectId));
          const currentPageEnd = currentPageStart + topProjectIds.size;

          // Only include projects after current page
          const otherProjects = sortedMinistryProjects.slice(currentPageEnd);

          let amountToOtherRecipients = 0;
          const topSpendingIds = new Set(topSpendings.map(s => s.spendingId));

          for (const otherProject of otherProjects) {
            for (const spending of fullData.spendings) {
              if (spending.spendingName === 'その他') continue; // Skip "その他" (handled separately)
              if (topSpendingIds.has(spending.spendingId)) continue; // Skip TopN recipients (handled above)

              const spendingProject = spending.projects.find(p => p.projectId === otherProject.projectId);
              if (spendingProject) {
                amountToOtherRecipients += spendingProject.amount;
              }
            }
          }

          // Only create link if "Other Projects" spending node exists
          const otherProjectsSpendingNodeExists = nodes.some(n => n.id === `project-spending-other-${ministry.id}`);
          if (amountToOtherRecipients > 0 && otherProjectsSpendingNodeExists) {
            links.push({
              source: `project-spending-other-${ministry.id}`,
              target: 'recipient-other-aggregated',
              value: amountToOtherRecipients,
            });
          }
        }
      }

      // Links from selected projects to "Other Recipients"
      for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
        if (otherAmount > 0 || otherAmount === 0) {
          // Use dummy value 0.001 if amount is 0 to prevent broken links
          const linkValue = otherAmount === 0 ? 0.001 : otherAmount;
          links.push({
            source: `project-spending-${projectId}`,
            target: 'recipient-other-aggregated',
            value: linkValue,
          });
        }
      }
    }
  }

  // Add "支出先なし" node for projects with 0 spending IDs
  if (projectsWithNoSpending.length > 0) {
    const totalBudgetNoSpending = projectsWithNoSpending.reduce((sum, p) => sum + p.totalBudget, 0);

    recipientNodes.push({
      id: 'recipient-no-spending',
      name: '支出先なし',
      type: 'recipient',
      value: 0, // Display as 0円
      details: {
        corporateNumber: '',
        location: '',
        projectCount: projectsWithNoSpending.length,
      },
    });

    // Create links from project budgets to "支出先なし" node
    for (const project of projectsWithNoSpending) {
      links.push({
        source: `project-budget-${project.projectId}`,
        target: 'recipient-no-spending',
        value: 0.001, // Dummy value to create visible link
      });
    }
  }

  const regularRecipients = recipientNodes.filter(
    n => n.id !== 'recipient-other-aggregated' && n.id !== 'recipient-other-named' && n.id !== 'recipient-no-spending'
  );
  const otherNamedRecipient = recipientNodes.filter(n => n.id === 'recipient-other-named');
  const aggregatedOther = recipientNodes.filter(n => n.id === 'recipient-other-aggregated');
  const noSpendingRecipient = recipientNodes.filter(n => n.id === 'recipient-no-spending');

  nodes.push(...regularRecipients, ...otherNamedRecipient, ...aggregatedOther, ...noSpendingRecipient);

  // Filter out nodes that have no links (0-yen ghost nodes)
  // A node must appear in at least one link (as source or target)
  const linkedNodeIds = new Set<string>();
  for (const link of links) {
    linkedNodeIds.add(link.source);
    linkedNodeIds.add(link.target);
  }

  const filteredNodes = nodes.filter(node => linkedNodeIds.has(node.id));

  // Also filter out links with 0 value
  const filteredLinks = links.filter(link => link.value > 0);

  return { nodes: filteredNodes, links: filteredLinks };
}
