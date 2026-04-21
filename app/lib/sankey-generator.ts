import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord, MOFFundingData, FundingSources } from '@/types/structured';
import type {
  RS2024PresetData,
  SankeyNode,
  SankeyLink,
} from '@/types/preset';

// Cache the data in memory to avoid re-reading the large JSON file
let cachedData: RS2024StructuredData | null = null;
let cachedMOFData: MOFFundingData | null = null;

// Cache for generated results to avoid re-processing for same parameters
const resultCache = new Map<string, RS2024PresetData>();
const CACHE_SIZE_LIMIT = 100;

interface GenerateOptions {
  ministryOffset?: number;
  projectOffset?: number; // Deprecated: use projectDrilldownLevel instead
  ministryLimit?: number;
  projectLimit?: number;
  spendingLimit?: number;
  subcontractLimit?: number; // Spending View: Top N subcontract recipients
  targetMinistryName?: string;
  targetProjectName?: string;
  targetRecipientName?: string;
  drilldownLevel?: number; // Ministry drilldown: 0: Top10, 1: Top11-20, 2: Top21-30, etc.
  projectDrilldownLevel?: number; // Project drilldown (Ministry View): 0: Top10, 1: Top11-20, etc.
  spendingDrilldownLevel?: number; // Spending drilldown (Global View): 0: Top10, 1: Top11-20, etc.
}

function getCacheKey(options: GenerateOptions): string {
  // Canonicalize options with defaults
  const canonicalOptions = {
    ministryOffset: options.ministryOffset ?? 0,
    projectOffset: options.projectOffset ?? 0, // Keep for backward compatibility
    projectDrilldownLevel: options.projectDrilldownLevel ?? 0,
    spendingDrilldownLevel: options.spendingDrilldownLevel ?? 0,
    ministryLimit: options.ministryLimit ?? 3,
    projectLimit: options.projectLimit ?? 3,
    spendingLimit: options.spendingLimit ?? 5,
    subcontractLimit: options.subcontractLimit ?? 10,
    targetMinistryName: options.targetMinistryName ?? '',
    targetProjectName: options.targetProjectName ?? '',
    targetRecipientName: options.targetRecipientName ?? '',
    drilldownLevel: options.drilldownLevel ?? 0,
  };
  return JSON.stringify(canonicalOptions);
}

/**
 * 府省庁名からMOF財源情報を取得
 * RSシステムの府省庁名をMOF標準形式に変換してから検索
 */
function getMinistryFundingSources(ministryName: string): FundingSources | undefined {
  if (!cachedMOFData) return undefined;

  // RSシステムの府省庁名からMOF形式への変換マップ
  const RS_TO_MOF_MAPPING: Record<string, string> = {
    '内閣官房': '内閣',
    '警察庁': '内閣府',
    '金融庁': '内閣府',
    '消費者庁': '内閣府',
    '個人情報保護委員会': '内閣府',
    '公害等調整委員会': '総務省',
    '消防庁': '総務省',
    '公安調査庁': '法務省',
    '出入国在留管理庁': '法務省',
    '公正取引委員会': '内閣府',
    '国家公安委員会': '内閣府',
    '宮内庁': '内閣府',
    '特許庁': '経済産業省',
    '中小企業庁': '経済産業省',
    '資源エネルギー庁': '経済産業省',
    '気象庁': '国土交通省',
    '海上保安庁': '国土交通省',
    '観光庁': '国土交通省',
    '林野庁': '農林水産省',
    '水産庁': '農林水産省',
    '文化庁': '文部科学省',
    'スポーツ庁': '文部科学省',
    '原子力規制委員会': '環境省',
    '検察庁': '法務省',
  };

  const mofMinistryName = RS_TO_MOF_MAPPING[ministryName] || ministryName;

  // 府省庁別財源情報から検索
  const ministryFunding = cachedMOFData.ministryFundings.find(
    (m) => m.ministryName === mofMinistryName
  );

  if (ministryFunding) {
    return ministryFunding.totalFunding;
  }

  // 見つからない場合は一般会計の按分（概算）を返す
  return undefined;
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
    spendingDrilldownLevel = 0,
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

  // Calculate spendingOffset from spendingDrilldownLevel
  const spendingOffset = spendingDrilldownLevel * spendingLimit;

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

  // 1.5. Load MOF funding data
  if (!cachedMOFData) {
    const mofDataPath = path.join(process.cwd(), 'public/data/mof-funding-2024.json');
    try {
      if (fs.existsSync(mofDataPath)) {
        const rawMOFData = fs.readFileSync(mofDataPath, 'utf-8');
        cachedMOFData = JSON.parse(rawMOFData);
      }
    } catch (error) {
      console.warn('MOF funding data not found or invalid, funding info will be unavailable');
    }
  }

  // 2. Select Data
  const selection = selectData(fullData, {
    offset: ministryOffset,
    projectOffset: calculatedProjectOffset,
    spendingOffset,
    limit: ministryLimit,
    projectLimit,
    spendingLimit,
    targetMinistryName,
    targetProjectName,
    targetRecipientName,
    drilldownLevel,
    spendingDrilldownLevel,
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
      subcontractLimit: options.subcontractLimit,
      drilldownLevel,
      projectDrilldownLevel,
      spendingDrilldownLevel,
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
        totalFilteredSpendings: selection.totalFilteredRecipients,
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

  // Global View スライダー用
  totalFilteredRecipients?: number; // フィルタ後の支出先総数（"その他"除外）

  // Ministry View用
  ministryTotalProjects?: number; // 選択した府省庁の総事業数

  // Spending Drilldown用
  spendingDrilldownLevel?: number; // 支出先ドリルダウンレベル
  top10SpendingTotal?: number; // Top10支出先の合計金額（ドリルダウン時のみ）
  cumulativeSpendings?: SpendingRecord[]; // 累積の支出先リスト（ドリルダウン時のTop合計に含まれる支出先）
  cumulativeProjects?: BudgetRecord[]; // 累積の事業リスト（累積支出先に貢献した事業Top10）
  cumulativeProjectSpendingMap?: Map<number, number>; // 累積事業ごとの累積支出先への支出金額
}

function selectData(
  data: RS2024StructuredData,
  options: {
    offset: number;
    projectOffset: number;
    spendingOffset: number;
    limit: number;
    projectLimit: number;
    spendingLimit: number;
    targetMinistryName?: string;
    targetProjectName?: string;
    targetRecipientName?: string;
    drilldownLevel?: number;
    spendingDrilldownLevel?: number;
  }
): DataSelection {
  const { offset, projectOffset, spendingOffset, limit, projectLimit, spendingLimit, targetMinistryName, targetProjectName, targetRecipientName, drilldownLevel = 0, spendingDrilldownLevel = 0 } = options;

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

  // Spending Drilldown用
  let cumulativeSpendings: SpendingRecord[] | undefined = undefined;
  let top10SpendingTotal: number | undefined = undefined;
  let hasMoreProjects: boolean | undefined = undefined;
  let cumulativeProjectsList: BudgetRecord[] | undefined = undefined;
  let cumulativeProjectSpendingMapVar: Map<number, number> | undefined = undefined;

  // Ministry View用
  let ministryTotalProjects: number | undefined = undefined;

  // Global View スライダー用
  let totalFilteredRecipients: number | undefined = undefined;

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

    totalFilteredRecipients = allRecipients.length;

    // Apply spending drilldown if enabled
    const topRecipients = allRecipients.slice(spendingOffset, spendingOffset + spendingLimit);
    topSpendings = topRecipients;

    // Calculate cumulative spending total and recipient list for drilldown mode
    // This represents the total spending for all recipients shown up to the PREVIOUS level
    // Example: Level 1 shows recipients 11-20, so we need total for 1-10
    //          Level 2 shows recipients 21-30, so we need total for 1-20
    if (spendingDrilldownLevel > 0) {
      const cumulativeEndIndex = spendingDrilldownLevel * spendingLimit;
      const cumulativeRecipients = allRecipients.slice(0, cumulativeEndIndex);
      cumulativeSpendings = cumulativeRecipients; // Store for later use
      top10SpendingTotal = cumulativeRecipients.reduce((sum, r) => {
        return sum + (recipientSpendingFromSelectedMinistries.get(r.spendingId) || 0);
      }, 0);

      // Calculate cumulative projects (projects that contributed to cumulativeRecipients)
      const cumulativeRecipientIds = new Set(cumulativeRecipients.map(r => r.spendingId));
      const projectSpendingToCumulative = new Map<number, number>();

      for (const project of projectsFromSelectedMinistries) {
        let spendingToCumulative = 0;
        const projectSpendings = data.spendings.filter(s =>
          s.projects.some(p => p.projectId === project.projectId)
        );
        for (const spending of projectSpendings) {
          if (cumulativeRecipientIds.has(spending.spendingId)) {
            spendingToCumulative += spending.projects
              .filter(p => p.projectId === project.projectId)
              .reduce((sum, p) => sum + p.amount, 0);
          }
        }
        if (spendingToCumulative > 0) {
          projectSpendingToCumulative.set(project.projectId, spendingToCumulative);
        }
      }

      // Select top projects that contributed to cumulative recipients
      const cumulativeContributingProjects = projectsFromSelectedMinistries
        .filter(b => projectSpendingToCumulative.has(b.projectId))
        .sort((a, b) => {
          return (projectSpendingToCumulative.get(b.projectId) || 0) -
            (projectSpendingToCumulative.get(a.projectId) || 0);
        })
        .slice(0, spendingLimit); // Same limit as current topProjects

      cumulativeProjectsList = cumulativeContributingProjects;
      cumulativeProjectSpendingMapVar = projectSpendingToCumulative;
    }

    // 4. Find all projects that contribute to TopN recipients
    const topRecipientIds = new Set(topRecipients.map(r => r.spendingId));

    // Spending drilldown: プロジェクトは全体から選択（府省庁TopNに限定しない）
    const projectSource = spendingDrilldownLevel > 0 ? data.budgets : projectsFromSelectedMinistries;

    // Calculate each project's spending to top recipients
    const projectSpendingToTopRecipients = new Map<number, number>();
    for (const project of projectSource) {
      let spendingToTop = 0;
      const projectSpendings = data.spendings.filter(s =>
        s.projects.some(p => p.projectId === project.projectId)
      );
      for (const spending of projectSpendings) {
        if (topRecipientIds.has(spending.spendingId)) {
          spendingToTop += spending.projects
            .filter(p => p.projectId === project.projectId)
            .reduce((sum, p) => sum + p.amount, 0);
        }
      }
      if (spendingToTop > 0) {
        projectSpendingToTopRecipients.set(project.projectId, spendingToTop);
      }
    }

    // Select projects that contribute to TopN recipients
    // Sort by total budget (descending) for intuitive ordering
    const contributingProjects = projectSource
      .filter(b => projectSpendingToTopRecipients.has(b.projectId))
      .sort((a, b) => b.totalBudget - a.totalBudget)
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

  // Aggregate "Other" named spendings (all views except Recipient View)
  if (!targetRecipientName) {
    for (const project of data.budgets) {
      const projectSpendings = data.spendings
        .filter(s => project.spendingIds.includes(s.spendingId))
        .filter(s => s.spendingName === 'その他');

      const otherNamedTotal = projectSpendings.reduce((sum, s) => {
        return sum + s.projects
          .filter(p => p.projectId === project.projectId && p.isDirectFromGov !== false)
          .reduce((a, p) => a + p.amount, 0);
      }, 0);

      if (otherNamedTotal > 0) {
        otherNamedSpendingByProject.set(project.projectId, otherNamedTotal);
      }
    }
  }

  if (!targetRecipientName && (targetMinistryName || targetProjectName)) {
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
          if (currentPageProjectIds.includes(proj.projectId) && proj.isDirectFromGov !== false) {
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
            otherSpendingTotal += spending.projects
              .filter(p => p.projectId === project.projectId && p.isDirectFromGov !== false)
              .reduce((sum, p) => sum + p.amount, 0);
          }
        }

        if (otherSpendingTotal > 0) {
          otherSpendingsByProject.set(project.projectId, otherSpendingTotal);
        }
      }

    } else {
      // --- Project View: Select top spendings for the single project ---
      const topSpendingsArray: SpendingRecord[] = [];

      for (const project of topProjects) {
        const projectSpendings = data.spendings
          .filter(s => project.spendingIds.includes(s.spendingId))
          .filter(s => s.spendingName !== 'その他')
          .map(s => {
            // isDirectFromGov=false のブロック（再委託先ブロック）は除外して直接支出のみ集計
            const amountFromThisProject = s.projects
              .filter(p => p.projectId === project.projectId && p.isDirectFromGov !== false)
              .reduce((sum, p) => sum + p.amount, 0);
            return {
              spending: s,
              amountFromThisProject,
            };
          })
          .filter(({ amountFromThisProject }) => amountFromThisProject > 0); // 間接支出のみの会社を除外

        const sortedSpendings = projectSpendings.sort((a, b) => b.amountFromThisProject - a.amountFromThisProject);

        const topNSpendings = sortedSpendings.slice(0, spendingLimit);

        // ソート済みの順序を保持して追加
        for (const { spending } of topNSpendings) {
          topSpendingsArray.push(spending);
        }

        const otherSpendingTotal = sortedSpendings
          .slice(spendingLimit)
          .reduce((sum, { amountFromThisProject }) => sum + amountFromThisProject, 0);

        if (otherSpendingTotal > 0) {
          otherSpendingsByProject.set(project.projectId, otherSpendingTotal);
        }
      }

      topSpendings = topSpendingsArray;
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
    totalFilteredRecipients,
    spendingDrilldownLevel,
    top10SpendingTotal,
    cumulativeSpendings,
    cumulativeProjects: cumulativeProjectsList,
    cumulativeProjectSpendingMap: cumulativeProjectSpendingMapVar,
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
    subcontractLimit?: number;
    drilldownLevel?: number;
    spendingDrilldownLevel?: number;
    projectDrilldownLevel?: number;
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
    top10SpendingTotal,
    cumulativeSpendings,
    cumulativeProjects,
    cumulativeProjectSpendingMap,
  } = selection;

  const { offset, targetMinistryName, targetProjectName, targetRecipientName, ministryLimit, projectLimit, spendingLimit, drilldownLevel = 0, projectDrilldownLevel = 0, spendingDrilldownLevel = 0 } = options;

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
        amount += s.projects
          .filter(p => p.projectId === project.projectId)
          .reduce((sum, p) => sum + p.amount, 0);
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
        spendingAmount += s.projects
          .filter(p => p.projectId === project.projectId)
          .reduce((sum, p) => sum + p.amount, 0);
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
          bureauCount: ministry.bureauCount,
          fundingSources: getMinistryFundingSources(ministry.name),
        }
      });
    }

    // Column 4: Subcontract Recipient Nodes (再委託先)
    const subcontractNodes: SankeyNode[] = [];
    const subcontractLinks: SankeyLink[] = [];

    // 選択した支出先の再委託先を取得
    const selectedRecipient = topSpendings.find(s => s.spendingName === targetRecipientName);
    const outflows = selectedRecipient?.outflows || [];

    if (outflows.length > 0) {
      // 再委託先を集約（個別支出先または同名の支出先はまとめる）
      const subcontractAggregation = new Map<string, {
        name: string;
        corporateNumber?: string;
        flowTypes: Set<string>;
        totalAmount: number;
        projects: Map<number, { projectId: number; projectName: string; amount: number }>;
      }>();

      for (const flow of outflows) {
        // 個別支出先が存在する場合は個別にノードを作成
        if (flow.recipients && flow.recipients.length > 0) {
          for (const recipient of flow.recipients) {
            const recipientKey = `${recipient.name}_${recipient.corporateNumber}`;
            if (!subcontractAggregation.has(recipientKey)) {
              subcontractAggregation.set(recipientKey, {
                name: recipient.name,
                corporateNumber: recipient.corporateNumber,
                flowTypes: new Set(),
                totalAmount: 0,
                projects: new Map(),
              });
            }
            const agg = subcontractAggregation.get(recipientKey)!;
            agg.flowTypes.add(flow.flowType);
            agg.totalAmount += recipient.amount;

            // 事業情報を追加
            if (!agg.projects.has(flow.projectId)) {
              agg.projects.set(flow.projectId, {
                projectId: flow.projectId,
                projectName: flow.projectName,
                amount: 0,
              });
            }
            const projectData = agg.projects.get(flow.projectId)!;
            projectData.amount += recipient.amount;
          }
        } else {
          // 個別支出先がない場合はブロック名で集約
          const targetName = flow.targetBlockName;
          if (!subcontractAggregation.has(targetName)) {
            subcontractAggregation.set(targetName, {
              name: targetName,
              flowTypes: new Set(),
              totalAmount: 0,
              projects: new Map(),
            });
          }
          const agg = subcontractAggregation.get(targetName)!;
          agg.flowTypes.add(flow.flowType);
          agg.totalAmount += flow.amount;

          // 事業情報を追加
          if (!agg.projects.has(flow.projectId)) {
            agg.projects.set(flow.projectId, {
              projectId: flow.projectId,
              projectName: flow.projectName,
              amount: 0,
            });
          }
          const projectData = agg.projects.get(flow.projectId)!;
          projectData.amount += flow.amount;
        }
      }

      // 再委託先を金額順にソート
      const sortedSubcontracts = Array.from(subcontractAggregation.entries())
        .map(([key, data]) => ({ key, ...data }))
        .sort((a, b) => b.totalAmount - a.totalAmount);

      // TopN設定（デフォルト10）
      const subcontractLimit = options.subcontractLimit || 10;
      const topSubcontracts = sortedSubcontracts.slice(0, subcontractLimit);
      const otherSubcontracts = sortedSubcontracts.slice(subcontractLimit);

      // TopN再委託先ノードを作成
      for (const data of topSubcontracts) {
        const nodeId = `subcontract-${data.key}`;
        const projectList = Array.from(data.projects.values()).sort((a, b) => b.amount - a.amount);

        // 名前からspendingRecordを検索してtagsを取得
        const matchingSpending = fullData.spendings.find(s => s.spendingName === data.name);

        subcontractNodes.push({
          id: nodeId,
          name: data.name,
          type: 'subcontract-recipient',
          value: data.totalAmount,
          details: {
            flowTypes: Array.from(data.flowTypes).join(', '),
            sourceRecipient: targetRecipientName,
            projects: projectList,
            tags: matchingSpending?.tags,
          }
        });

        // リンク: 支出先 → 再委託先
        subcontractLinks.push({
          source: recipientNodeId,
          target: nodeId,
          value: data.totalAmount,
          details: {
            blockName: Array.from(data.flowTypes).join(', '),
          }
        });
      }

      // 「その他の再委託先」集約ノード
      if (otherSubcontracts.length > 0) {
        const otherTotalAmount = otherSubcontracts.reduce((sum, s) => sum + s.totalAmount, 0);
        const otherFlowTypes = new Set<string>();
        const otherProjects = new Map<number, { projectId: number; projectName: string; amount: number }>();

        for (const data of otherSubcontracts) {
          for (const flowType of data.flowTypes) {
            otherFlowTypes.add(flowType);
          }
          for (const [projectId, project] of data.projects) {
            if (!otherProjects.has(projectId)) {
              otherProjects.set(projectId, { ...project, amount: 0 });
            }
            otherProjects.get(projectId)!.amount += project.amount;
          }
        }

        const otherNodeId = 'subcontract-other';
        const otherProjectList = Array.from(otherProjects.values()).sort((a, b) => b.amount - a.amount);

        subcontractNodes.push({
          id: otherNodeId,
          name: `再委託先\n(Top${subcontractLimit}以外)`,
          type: 'subcontract-recipient',
          value: otherTotalAmount,
          details: {
            flowTypes: Array.from(otherFlowTypes).join(', '),
            sourceRecipient: targetRecipientName,
            projects: otherProjectList,
          }
        });

        subcontractLinks.push({
          source: recipientNodeId,
          target: otherNodeId,
          value: otherTotalAmount,
          details: {
            blockName: Array.from(otherFlowTypes).join(', '),
          }
        });
      }
    }

    // Add nodes in order: recipient, project spending, project budget, ministry budget, subcontract
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
    nodes.push(...subcontractNodes); // 再委託先ノード
    links.push(...subcontractLinks); // 再委託先リンク

    // 【新規追加】TopN府省庁からの「事業(TopN以外)」ノード
    const otherProjectsSpending = selection.otherProjectsSpendingInSpendingView || 0;
    const otherProjectsBudget = otherProjectsSpending; // Budget情報がないので支出額で代用

    if (otherProjectsSpending > 0) {
      // Column 1: 事業予算(TopN以外)ノード
      nodes.push({
        id: 'project-budget-other-spending-view',
        name: `事業\n(Top${projectLimit}以外)`,
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
        name: `事業\n(Top${projectLimit}以外)`,
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
        name: `府省庁\n(Top${ministryLimit}以外)`,
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
        name: `事業\n(Top${ministryLimit}以外府省庁)`,
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
        name: `事業\n(Top${ministryLimit}以外府省庁)`,
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
      // Global View: use "予算総計" or "予算総計\n(Top10以外)" based on drilldownLevel
      const currentDrilldownLevel = drilldownLevel ?? 0;
      nodeName = currentDrilldownLevel === 0 ? '予算総計' : `予算総計\n(Top${ministryLimit * currentDrilldownLevel}以外)`;
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

      // In Ministry View with project drilldown, add "(TopN以外)" label
      let ministryNodeName = ministry.name;
      if (targetMinistryName && projectDrilldownLevel > 0) {
        const currentTopN = projectLimit * projectDrilldownLevel;
        ministryNodeName = `${ministry.name}\n(Top${currentTopN}以外)`;
      }

      standardMinistryNodes.push({
        id: `ministry-budget-${ministry.id}`,
        name: ministryNodeName,
        type: 'ministry-budget',
        value: ministryValue,
        originalId: ministry.id,
        details: {
          projectCount: projectCount,
          bureauCount: ministry.bureauCount,
          fundingSources: getMinistryFundingSources(ministry.name),
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
        name: `府省庁\n(Top${currentTopN}以外)`,
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

  // In spending drilldown mode (Level 1+), cumulative projects are aggregated into "事業(TopN)" node
  // Only current topProjects are rendered as individual nodes
  const allProjectsToRender = topProjects;

  // Create budget nodes for all projects
  for (const project of allProjectsToRender) {
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
          name: `事業\n(Top${projectLimit}以外)`,
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

    // Calculate cumulative budget by ministry for later adjustment
    const cumulativeByMinistry = new Map<string, number>();
    if (spendingDrilldownLevel > 0 && cumulativeProjects) {
      for (const project of cumulativeProjects) {
        const current = cumulativeByMinistry.get(project.ministry) || 0;
        cumulativeByMinistry.set(project.ministry, current + project.totalBudget);
      }
    }

    // Calculate total other budget first (links will be created after node is confirmed)
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name) || 0;
      totalOtherBudget += otherBudget;
    }
    totalOtherBudget += otherMinistriesBudget;

    // Link from "Return to TopN" nodes now goes to dummy recipient nodes
    // (See recipient node creation section below)

    // In spending drilldown mode, add "事業(Top10)" aggregated node FIRST for top positioning
    if (spendingDrilldownLevel > 0 && cumulativeProjects && cumulativeProjectSpendingMap) {
      const cumulativeTopN = spendingDrilldownLevel * spendingLimit;
      const cumulativeBudgetTotal = cumulativeProjects.reduce((sum, p) => sum + p.totalBudget, 0);

      // Create "事業(Top10)" budget node with dummy value for thin display
      // actualValue is stored in details for label display
      const DUMMY_NODE_VALUE = 0.001;
      projectBudgetNodes.unshift({
        id: 'project-budget-cumulative',
        name: `事業\n(Top${cumulativeTopN})`,
        type: 'project-budget',
        value: DUMMY_NODE_VALUE,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          initialBudget: cumulativeBudgetTotal,
          supplementaryBudget: 0,
          carryoverBudget: 0,
          reserveFund: 0,
          totalBudget: cumulativeBudgetTotal,
          executedAmount: 0,
          carryoverToNext: 0,
          accountCategory: '',
          actualValue: cumulativeBudgetTotal, // Store actual value for label
        },
      });

      // Links from ministries to "事業(Top10)" node - use dummy values
      for (const ministry of topMinistries) {
        const budgetFromMinistry = cumulativeByMinistry.get(ministry.name);
        if (budgetFromMinistry && budgetFromMinistry > 0) {
          links.push({
            source: `ministry-budget-${ministry.id}`,
            target: 'project-budget-cumulative',
            value: DUMMY_NODE_VALUE / topMinistries.length, // Distribute dummy value
          });
        }
      }
    }

    // In spending drilldown mode, subtract cumulative projects budget from "Other" to avoid double counting
    let adjustedOtherBudget = totalOtherBudget;
    if (spendingDrilldownLevel > 0 && cumulativeProjects) {
      const cumulativeBudgetTotal = cumulativeProjects.reduce((sum, p) => sum + p.totalBudget, 0);
      adjustedOtherBudget = Math.max(0, totalOtherBudget - cumulativeBudgetTotal);
    }

    if (adjustedOtherBudget > 0) {
      // Calculate the label based on spending drilldown level
      // Level 0: 事業(Top10以外)
      // Level 1+: 事業(Top20以外) - aligned with 支出先(Top20以外)
      const cumulativeTopN = (spendingDrilldownLevel + 1) * spendingLimit;
      const otherProjectsLabel = `事業\n(Top${cumulativeTopN}以外)`;

      projectBudgetNodes.push({
        id: 'project-budget-other-global',
        name: otherProjectsLabel,
        type: 'project-budget',
        value: adjustedOtherBudget,
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

      // Links from topMinistries to "Other Projects" - adjust for cumulative projects
      for (const ministry of topMinistries) {
        const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name) || 0;
        const cumulativeBudgetFromMinistry = cumulativeByMinistry.get(ministry.name) || 0;
        const adjustedMinistryOtherBudget = Math.max(0, otherBudget - cumulativeBudgetFromMinistry);

        if (adjustedMinistryOtherBudget > 0) {
          links.push({
            source: `ministry-budget-${ministry.id}`,
            target: 'project-budget-other-global',
            value: adjustedMinistryOtherBudget,
          });
        }
      }

      // Link from "Other Ministries" to "Other Projects"
      if (otherMinistriesBudget > 0) {
        links.push({
          source: 'ministry-budget-other',
          target: 'project-budget-other-global',
          value: otherMinistriesBudget,
        });
      }
    }
  }
  nodes.push(...projectBudgetNodes);

  // Column 3: Project Spending Nodes
  const projectSpendingNodes: SankeyNode[] = [];

  // Track projects with 0 spending IDs for "支出先なし" node
  const projectsWithNoSpending: BudgetRecord[] = [];

  // Create spending nodes for all projects (same as allProjectsToRender for budget nodes)
  for (const project of allProjectsToRender) {
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
          name: `事業\n(Top${projectLimit}以外)`,
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

    // In spending drilldown mode, add "事業(Top10)" spending node FIRST for top positioning
    if (spendingDrilldownLevel > 0 && cumulativeProjects && cumulativeProjectSpendingMap) {
      const cumulativeTopN = spendingDrilldownLevel * spendingLimit;
      const cumulativeSpendingTotal = Array.from(cumulativeProjectSpendingMap.values()).reduce((sum, v) => sum + v, 0);

      // Use dummy value for thin display
      const DUMMY_NODE_VALUE = 0.001;
      projectSpendingNodes.unshift({
        id: 'project-spending-cumulative',
        name: `事業\n(Top${cumulativeTopN})`,
        type: 'project-spending',
        value: DUMMY_NODE_VALUE,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          executionRate: 0,
          spendingCount: cumulativeProjects.length,
          actualValue: cumulativeSpendingTotal, // Store actual value for label
        },
      });

      // Link from "事業(Top10)" budget to spending - use dummy value
      links.push({
        source: 'project-budget-cumulative',
        target: 'project-spending-cumulative',
        value: DUMMY_NODE_VALUE,
      });
    }

    // In spending drilldown mode, subtract cumulative projects spending from "Other" to avoid double counting
    let adjustedOtherSpending = totalOtherSpending;
    let adjustedOtherBudgetForLink = totalOtherBudget;
    if (spendingDrilldownLevel > 0 && cumulativeProjects && cumulativeProjectSpendingMap) {
      const cumulativeSpendingTotal = Array.from(cumulativeProjectSpendingMap.values()).reduce((sum, v) => sum + v, 0);
      const cumulativeBudgetTotal = cumulativeProjects.reduce((sum, p) => sum + p.totalBudget, 0);
      adjustedOtherSpending = Math.max(0, totalOtherSpending - cumulativeSpendingTotal);
      adjustedOtherBudgetForLink = Math.max(0, totalOtherBudget - cumulativeBudgetTotal);
    }

    if (adjustedOtherSpending > 0) {
      // Calculate the label based on spending drilldown level
      // Level 0: 事業(Top10以外)
      // Level 1+: 事業(Top20以外) - aligned with 支出先(Top20以外)
      const cumulativeTopN = (spendingDrilldownLevel + 1) * spendingLimit;
      const otherProjectsLabel = `事業\n(Top${cumulativeTopN}以外)`;

      projectSpendingNodes.push({
        id: 'project-spending-other-global',
        name: otherProjectsLabel,
        type: 'project-spending',
        value: adjustedOtherSpending,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          executionRate: 0,
          spendingCount: 0,
        },
      });

      // Link from budget-side to spending-side "Other Projects"
      // Only create link if budget-side node exists (adjustedOtherBudgetForLink > 0)
      if (adjustedOtherBudgetForLink > 0) {
        const linkValue = Math.min(adjustedOtherBudgetForLink, adjustedOtherSpending);
        if (linkValue > 0) {
          links.push({
            source: 'project-budget-other-global',
            target: 'project-spending-other-global',
            value: linkValue,
          });
        }
      }
    }
  }
  nodes.push(...projectSpendingNodes);

  // Column 4: Recipient Nodes
  const recipientNodes: SankeyNode[] = [];

  // Add Top Summary node if in spending drilldown mode (FIRST for top positioning)
  if (isGlobalView && spendingDrilldownLevel > 0 && top10SpendingTotal) {
    // Calculate the cumulative range for the summary label
    // Level 1: Top1-10, Level 2: Top1-20, Level 3: Top1-30, etc.
    const cumulativeEnd = spendingDrilldownLevel * spendingLimit;

    // Use dummy value for thin display
    const DUMMY_NODE_VALUE = 0.001;
    recipientNodes.unshift({
      id: 'recipient-top10-summary',
      name: `支出先\n(Top${cumulativeEnd})`,
      type: 'recipient',
      value: DUMMY_NODE_VALUE,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: 0,
        actualValue: top10SpendingTotal, // Store actual value for label
      },
    });
    // Note: Links to this summary node are created below
  }

  if (isGlobalView) {
    // In ministry drilldown (level > 0), build a lookup to exclude projects from excluded ministries.
    // When spending drilldown is active, topProjects is built from all budgets, so excluded ministry
    // projects can appear in topProjects. We need to filter them out from recipient node values/links.
    const projectMinistryMap = drilldownLevel > 0
      ? new Map(fullData.budgets.map(b => [b.projectId, b.ministry]))
      : null;
    const selectedMinistryNames = drilldownLevel > 0
      ? new Set(topMinistries.map(m => m.name))
      : null;

    // Global View: Create nodes for current topSpendings and links from their projects
    for (const spending of topSpendings) {
      // Calculate spending amount from selected TopN projects only
      // (In ministry drilldown, also filter to selected ministries only)
      let spendingFromSelectedProjects = 0;
      for (const spendingProject of spending.projects) {
        // Only count spending from topProjects (selected TopN projects)
        const projectExists = topProjects.some(p => p.projectId === spendingProject.projectId);
        if (!projectExists) continue;
        // In ministry drilldown, exclude projects from excluded ministries
        if (projectMinistryMap && selectedMinistryNames) {
          const ministry = projectMinistryMap.get(spendingProject.projectId);
          if (!ministry || !selectedMinistryNames.has(ministry)) continue;
        }
        spendingFromSelectedProjects += spendingProject.amount;
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
          tags: spending.tags,
        },
      });

      // Create links from all projects that contribute to this spending
      for (const spendingProject of spending.projects) {
        // Check if this project's spending node exists (i.e., it's in topProjects)
        const projectExists = topProjects.some(p => p.projectId === spendingProject.projectId);
        if (!projectExists) continue;
        // In ministry drilldown, exclude projects from excluded ministries
        if (projectMinistryMap && selectedMinistryNames) {
          const ministry = projectMinistryMap.get(spendingProject.projectId);
          if (!ministry || !selectedMinistryNames.has(ministry)) continue;
        }
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

    // If in drilldown mode, create link from "事業(Top10)" aggregated node to "支出先(Top10)" summary node
    // Use dummy value for thin display
    if (spendingDrilldownLevel > 0 && cumulativeProjects && cumulativeProjectSpendingMap) {
      const DUMMY_LINK_VALUE = 0.001;
      links.push({
        source: 'project-spending-cumulative',
        target: 'recipient-top10-summary',
        value: DUMMY_LINK_VALUE,
      });
    }
  } else {
    // Ministry/Project View: Calculate spending from selected projects only
    // First pass: calculate spending amounts for each recipient (direct from gov only)
    const recipientSpendingAmounts = new Map<number, number>();
    for (const project of topProjects) {
      for (const spending of topSpendings) {
        const amount = spending.projects
          .filter(p => p.projectId === project.projectId && p.isDirectFromGov !== false)
          .reduce((sum, p) => sum + p.amount, 0);
        if (amount > 0) {
          const currentAmount = recipientSpendingAmounts.get(spending.spendingId) || 0;
          recipientSpendingAmounts.set(spending.spendingId, currentAmount + amount);
        }
      }
    }

    // Second pass: create nodes and links
    for (const project of topProjects) {
      for (const spending of topSpendings) {
        // 直接支出ブロックのみを対象とする（isDirectFromGov=false の間接ブロックを除外）
        const matchingProjects = spending.projects.filter(
          p => p.projectId === project.projectId && p.isDirectFromGov !== false
        );
        if (matchingProjects.length > 0) {
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
                tags: spending.tags,
              },
            });
          }

          const totalAmount = matchingProjects.reduce((sum, p) => sum + p.amount, 0);
          // Use dummy value 0.001 if amount is 0 to prevent broken links
          const linkValue = totalAmount === 0 ? 0.001 : totalAmount;
          const blockName = matchingProjects.map(p => p.blockName).filter(Boolean).join(', ');

          links.push({
            source: `project-spending-${project.projectId}`,
            target: `recipient-${spending.spendingId}`,
            value: linkValue,
            details: {
              contractMethod: matchingProjects[0].contractMethod,
              blockName,
            },
          });
        }
      }
    }
  }


  // For Global View drilldown: compute excluded project IDs (from previously-shown ministries)
  // so that their "その他" spending is NOT counted in the current page's "その他" node.
  const excludedProjectIds = new Set<number>();
  if (isGlobalView && drilldownLevel > 0) {
    const allMinistriesSorted = fullData.budgetTree.ministries
      .slice()
      .sort((a, b) => b.totalBudget - a.totalBudget);
    const excludeCount = (ministryLimit ?? 3) * drilldownLevel;
    const excludedMinistryNames = new Set(allMinistriesSorted.slice(0, excludeCount).map(m => m.name));
    for (const b of fullData.budgets) {
      if (excludedMinistryNames.has(b.ministry)) {
        excludedProjectIds.add(b.projectId);
      }
    }
  }

  // "Other Named" (その他)
  let totalOtherNamedAmount = 0;
  for (const [projectId, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
    if (excludedProjectIds.has(projectId)) continue; // Skip excluded ministry projects
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

    // Global View: Link from "Other Projects" to "Other Named"
    if (isGlobalView) {
      let otherProjectsOtherNamedAmount = 0;
      for (const [projectId, amount] of otherNamedSpendingByProject.entries()) {
        if (topProjectIds.has(projectId)) continue; // Already linked directly
        if (excludedProjectIds.has(projectId)) continue; // Skip excluded ministries
        otherProjectsOtherNamedAmount += amount;
      }
      if (otherProjectsOtherNamedAmount > 0) {
        const otherProjectsSpendingNodeExists = nodes.some(n => n.id === 'project-spending-other-global');
        if (otherProjectsSpendingNodeExists) {
          links.push({
            source: 'project-spending-other-global',
            target: 'recipient-other-named',
            value: otherProjectsOtherNamedAmount,
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
          amountFromOtherProjects += spending.projects
            .filter(p => p.projectId === otherProject.projectId)
            .reduce((sum, p) => sum + p.amount, 0);
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
    // Strategy: Calculate total spending to recipients BEYOND the current drilldown threshold
    // This means excluding recipients from position 0 to (spendingDrilldownLevel + 1) * spendingLimit

    // First, rebuild the full sorted recipient list to get all recipients up to current threshold
    const selectedMinistryNames = new Set(topMinistries.map(m => m.name));
    const recipientSpendingFromSelectedMinistries = new Map<number, number>();

    for (const spending of fullData.spendings) {
      let totalFromSelected = 0;
      for (const project of spending.projects) {
        const budgetRecord = fullData.budgets.find((b: { projectId: number }) => b.projectId === project.projectId);
        if (budgetRecord && selectedMinistryNames.has(budgetRecord.ministry)) {
          totalFromSelected += project.amount;
        }
      }
      if (totalFromSelected > 0) {
        recipientSpendingFromSelectedMinistries.set(spending.spendingId, totalFromSelected);
      }
    }

    // Sort all recipients by spending amount (same order as in selectData)
    const allSortedRecipients = fullData.spendings
      .filter(s => recipientSpendingFromSelectedMinistries.has(s.spendingId))
      .sort((a, b) => {
        const aSpending = recipientSpendingFromSelectedMinistries.get(a.spendingId) || 0;
        const bSpending = recipientSpendingFromSelectedMinistries.get(b.spendingId) || 0;
        return bSpending - aSpending;
      });

    // Calculate the threshold: exclude all recipients from 0 to (spendingDrilldownLevel + 1) * spendingLimit
    const excludeUpToIndex = (spendingDrilldownLevel + 1) * spendingLimit;
    const excludedRecipients = allSortedRecipients.slice(0, excludeUpToIndex);
    const excludedRecipientIds = new Set(excludedRecipients.map(s => s.spendingId));

    // Calculate total spending to "Other Recipients" (beyond current threshold)
    // Include spending from both Top Projects and Other Projects
    for (const spending of allSortedRecipients) {
      // Skip if this recipient is within the excluded range (0 to current threshold)
      if (excludedRecipientIds.has(spending.spendingId)) continue;

      // Skip "その他" (handled separately)
      if (spending.spendingName === 'その他') continue;

      // Sum up all spending to this recipient from selected ministries
      const spendingAmount = recipientSpendingFromSelectedMinistries.get(spending.spendingId) || 0;
      totalOtherRecipientAmount += spendingAmount;
    }

    // Store the breakdown by project for linking purposes
    // This is used later to create links from individual projects to "Other Recipients"
    for (const project of topProjects) {
      let projectTotalToOthers = 0;

      for (const spendingId of project.spendingIds) {
        const spending = fullData.spendings.find(s => s.spendingId === spendingId);
        if (!spending) continue;

        // Skip excluded recipients and "その他"
        if (excludedRecipientIds.has(spendingId) || spending.spendingName === 'その他') continue;

        // This is an "other recipient"
        projectTotalToOthers += spending.projects
          .filter(p => p.projectId === project.projectId)
          .reduce((sum, p) => sum + p.amount, 0);
      }

      if (projectTotalToOthers > 0) {
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
    // Calculate the current TopN threshold based on drilldown level
    const currentThreshold = (spendingDrilldownLevel + 1) * spendingLimit;

    recipientNodes.push({
      id: 'recipient-other-aggregated',
      name: `支出先\n(Top${currentThreshold}以外)`,
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
          receivedFromTopProjects += recipient.projects
            .filter(rp => rp.projectId === project.projectId)
            .reduce((sum, p) => sum + p.amount, 0);
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

      // 2. Links from Top Projects to "Other Recipients"
      // These are the links we calculated and stored in otherSpendingsByProject
      for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
        if (otherAmount > 0) {
          links.push({
            source: `project-spending-${projectId}`,
            target: 'recipient-other-aggregated',
            value: otherAmount,
          });
        }
      }

      // 3. Link from "Other Projects" (Global) to "Other Recipients"
      // Calculate how much of "Other Projects" goes to "Other Recipients" (beyond current threshold)
      // This is: totalOtherRecipientAmount - (sum of otherSpendingsByProject)
      if (otherProjectsSpendingNode) {
        const topProjectsToOthers = Array.from(otherSpendingsByProject.values()).reduce((sum, amt) => sum + amt, 0);
        const otherProjectsToOthers = totalOtherRecipientAmount - topProjectsToOthers;

        if (otherProjectsToOthers > 0) {
          links.push({
            source: 'project-spending-other-global',
            target: 'recipient-other-aggregated',
            value: otherProjectsToOthers,
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

              amountToOtherRecipients += spending.projects
                .filter(p => p.projectId === otherProject.projectId)
                .reduce((sum, p) => sum + p.amount, 0);
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

  // Global/Ministry View: One aggregated node per direct recipient that has outflows
  // Project View: TopN individual subcontract recipient nodes aggregated across all direct recipients
  const subcontractNodes: SankeyNode[] = [];
  const isProjectView = !!targetProjectName && !isGlobalView;
  const isMinistryView = !!targetMinistryName && !targetProjectName && !isGlobalView;
  if (isGlobalView || isMinistryView) {
    for (const spending of topSpendings) {
      if (!spending.outflows || spending.outflows.length === 0) continue;

      const uniqueRecipients = new Set<string>();
      let totalOutflow = 0;
      for (const flow of spending.outflows) {
        if (flow.recipients && flow.recipients.length > 0) {
          for (const r of flow.recipients) {
            uniqueRecipients.add(`${r.name}_${r.corporateNumber}`);
            totalOutflow += r.amount;
          }
        } else {
          uniqueRecipients.add(flow.targetBlockName);
          totalOutflow += flow.amount;
        }
      }

      if (uniqueRecipients.size === 0 || totalOutflow === 0) continue;

      const nodeId = `subcontract-agg-${spending.spendingId}`;
      subcontractNodes.push({
        id: nodeId,
        name: `再委託先\n(${uniqueRecipients.size}先)`,
        type: 'subcontract-recipient',
        value: totalOutflow,
        details: {
          isGlobalSubcontractAgg: true,
          spendingId: spending.spendingId,
          sourceRecipient: spending.spendingName,
          corporateNumber: '',
          location: '',
          projectCount: uniqueRecipients.size,
        },
      });

      links.push({
        source: `recipient-${spending.spendingId}`,
        target: nodeId,
        value: totalOutflow === 0 ? 0.001 : totalOutflow,
      });
    }
  } else if (isProjectView) {
    // Aggregate subcontract recipients across all direct recipients, filtered to the selected project
    const selectedProjectId = topProjects[0]?.projectId ?? null;
    const subcontractLimit = options.subcontractLimit ?? 10;

    const subcontractAggregation = new Map<string, {
      name: string;
      corporateNumber?: string;
      flowTypes: Set<string>;
      totalAmount: number;
      perSource: Map<number, number>; // spendingId → amount
      projects: Map<number, { projectId: number; projectName: string; amount: number }>;
    }>();

    for (const spending of topSpendings) {
      if (!spending.outflows || spending.outflows.length === 0) continue;

      const relevantOutflows = selectedProjectId !== null
        ? spending.outflows.filter(f => f.projectId === selectedProjectId)
        : spending.outflows;

      if (relevantOutflows.length === 0) continue;

      for (const flow of relevantOutflows) {
        if (flow.recipients && flow.recipients.length > 0) {
          for (const r of flow.recipients) {
            const key = `${r.name}_${r.corporateNumber}`;
            if (!subcontractAggregation.has(key)) {
              subcontractAggregation.set(key, { name: r.name, corporateNumber: r.corporateNumber, flowTypes: new Set(), totalAmount: 0, perSource: new Map(), projects: new Map() });
            }
            const agg = subcontractAggregation.get(key)!;
            agg.flowTypes.add(flow.flowType);
            agg.totalAmount += r.amount;
            agg.perSource.set(spending.spendingId, (agg.perSource.get(spending.spendingId) ?? 0) + r.amount);
            if (!agg.projects.has(flow.projectId)) {
              agg.projects.set(flow.projectId, { projectId: flow.projectId, projectName: flow.projectName, amount: 0 });
            }
            agg.projects.get(flow.projectId)!.amount += r.amount;
          }
        } else {
          const key = flow.targetBlockName;
          if (!subcontractAggregation.has(key)) {
            subcontractAggregation.set(key, { name: flow.targetBlockName, flowTypes: new Set(), totalAmount: 0, perSource: new Map(), projects: new Map() });
          }
          const agg = subcontractAggregation.get(key)!;
          agg.flowTypes.add(flow.flowType);
          agg.totalAmount += flow.amount;
          agg.perSource.set(spending.spendingId, (agg.perSource.get(spending.spendingId) ?? 0) + flow.amount);
          if (!agg.projects.has(flow.projectId)) {
            agg.projects.set(flow.projectId, { projectId: flow.projectId, projectName: flow.projectName, amount: 0 });
          }
          agg.projects.get(flow.projectId)!.amount += flow.amount;
        }
      }
    }

    const sortedSubcontracts = Array.from(subcontractAggregation.entries())
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const topSubcontracts = sortedSubcontracts.slice(0, subcontractLimit);
    const otherSubcontracts = sortedSubcontracts.slice(subcontractLimit);

    for (const data of topSubcontracts) {
      const nodeId = `subcontract-${data.key}`;
      const projectList = Array.from(data.projects.values()).sort((a, b) => b.amount - a.amount);
      subcontractNodes.push({
        id: nodeId,
        name: data.name,
        type: 'subcontract-recipient',
        value: data.totalAmount,
        details: {
          flowTypes: Array.from(data.flowTypes).join(', '),
          sourceRecipient: targetProjectName,
          projects: projectList,
        },
      });
      for (const [spendingId, amount] of data.perSource) {
        links.push({ source: `recipient-${spendingId}`, target: nodeId, value: amount });
      }
    }

    if (otherSubcontracts.length > 0) {
      const otherPerSource = new Map<number, number>();
      let otherTotal = 0;
      const otherFlowTypes = new Set<string>();
      const otherProjects = new Map<number, { projectId: number; projectName: string; amount: number }>();
      for (const data of otherSubcontracts) {
        otherTotal += data.totalAmount;
        for (const flowType of data.flowTypes) otherFlowTypes.add(flowType);
        for (const [spendingId, amount] of data.perSource) {
          otherPerSource.set(spendingId, (otherPerSource.get(spendingId) ?? 0) + amount);
        }
        for (const [projectId, project] of data.projects) {
          if (!otherProjects.has(projectId)) otherProjects.set(projectId, { ...project, amount: 0 });
          otherProjects.get(projectId)!.amount += project.amount;
        }
      }
      const otherProjectList = Array.from(otherProjects.values()).sort((a, b) => b.amount - a.amount);
      subcontractNodes.push({
        id: 'subcontract-project-other',
        name: `再委託先\n(Top${subcontractLimit}以外)`,
        type: 'subcontract-recipient',
        value: otherTotal,
        details: {
          flowTypes: Array.from(otherFlowTypes).join(', '),
          sourceRecipient: targetProjectName,
          projects: otherProjectList,
        },
      });
      for (const [spendingId, amount] of otherPerSource) {
        links.push({ source: `recipient-${spendingId}`, target: 'subcontract-project-other', value: amount });
      }
    }
  }

  // Global/Ministry View: sort subcontract nodes to match recipient node vertical order
  // (prevents position mismatch caused by d3-sankey's input-sort on multi-project link graphs)
  if (isGlobalView || isMinistryView) {
    const recipientOrderMap = new Map(regularRecipients.map((n, i) => [n.id, i]));
    subcontractNodes.sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aSpendingId = (a.details as any)?.spendingId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bSpendingId = (b.details as any)?.spendingId;
      const aOrder = recipientOrderMap.get(`recipient-${aSpendingId}`) ?? 999;
      const bOrder = recipientOrderMap.get(`recipient-${bSpendingId}`) ?? 999;
      return aOrder - bOrder;
    });
  }

  nodes.push(...regularRecipients, ...otherNamedRecipient, ...aggregatedOther, ...noSpendingRecipient, ...subcontractNodes);

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
