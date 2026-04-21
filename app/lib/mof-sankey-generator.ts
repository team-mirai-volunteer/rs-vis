/**
 * MOF予算全体ビューのサンキー図生成ロジック
 */

import type {
  MOFBudgetData,
  MOFBudgetOverviewData,
  MOFBudgetNodeDetails,
  MOFBudgetNodeType,
} from '@/types/mof-budget-overview';
import type { SankeyNode, SankeyLink } from '@/types/sankey';

/**
 * MOF予算全体ビューのサンキー図データを生成
 */
export function generateMOFBudgetOverviewSankey(
  mofData: MOFBudgetData
): MOFBudgetOverviewData {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];
  const links: SankeyLink[] = [];

  // Column 1: 財源+特会ノード（税収詳細+年金特会+労働保険特会+その他特会）
  const sourceNodes = createSourceNodes(mofData);
  nodes.push(...sourceNodes);

  // Column 2: 会計集約ノード（一般会計、特別会計集約）
  const accountAggregateNodes = createAccountAggregateNodes(mofData);
  nodes.push(...accountAggregateNodes);

  // Column 3: RS対象区分ノード
  const rsCategoryNodes = createRSCategoryNodes(mofData);
  nodes.push(...rsCategoryNodes);

  // Column 4: 詳細内訳ノード
  const detailNodes = createBudgetDetailNodes(mofData);
  nodes.push(...detailNodes);

  // Column 5: RS集約ノード
  const summaryNodes = createRSSummaryNodes(mofData);
  nodes.push(...summaryNodes);

  // リンク生成
  links.push(...createSourceToAggregateLinks(sourceNodes, accountAggregateNodes, mofData));
  links.push(...createAggregateToRSCategoryLinks(accountAggregateNodes, rsCategoryNodes, mofData));
  links.push(...createRSCategoryToDetailLinks(rsCategoryNodes, detailNodes));
  links.push(...createDetailToSummaryLinks(detailNodes, summaryNodes));

  // メタデータとサマリー
  const metadata = {
    generatedAt: new Date().toISOString(),
    fiscalYear: mofData.fiscalYear,
    totalBudget: mofData.generalAccount.total + mofData.specialAccount.total,
    rsTargetBudget:
      mofData.generalAccount.expenditure.rsTarget +
      mofData.specialAccount.expenditure.rsTarget.total,
    rsExcludedBudget:
      mofData.generalAccount.expenditure.debtService +
      mofData.generalAccount.expenditure.localAllocationTax +
      mofData.generalAccount.expenditure.reserves +
      mofData.specialAccount.expenditure.rsExcluded.total,
    dataSource: '財務省 令和5年度予算（2023年度）',
    notes: [
      '予算総額556.3兆円は「予算書上の金額」です（重複含む）',
      'RS対象範囲は「事業レビュー対象」のみです（151.1兆円、27.2%）',
      '国債費・地方交付税等の制度的支出（405.2兆円）は含まれません',
    ],
  };

  const summary = {
    generalAccount: {
      total: mofData.generalAccount.total,
      rsTarget: mofData.generalAccount.expenditure.rsTarget,
      rsExcluded:
        mofData.generalAccount.expenditure.debtService +
        mofData.generalAccount.expenditure.localAllocationTax +
        mofData.generalAccount.expenditure.reserves,
      rsTargetRate:
        (mofData.generalAccount.expenditure.rsTarget /
          mofData.generalAccount.total) *
        100,
    },
    specialAccount: {
      total: mofData.specialAccount.total,
      rsTarget: mofData.specialAccount.expenditure.rsTarget.total,
      rsExcluded: mofData.specialAccount.expenditure.rsExcluded.total,
      rsTargetRate:
        (mofData.specialAccount.expenditure.rsTarget.total /
          mofData.specialAccount.total) *
        100,
    },
    overall: {
      total: mofData.generalAccount.total + mofData.specialAccount.total,
      rsTarget:
        mofData.generalAccount.expenditure.rsTarget +
        mofData.specialAccount.expenditure.rsTarget.total,
      rsExcluded:
        mofData.generalAccount.expenditure.debtService +
        mofData.generalAccount.expenditure.localAllocationTax +
        mofData.generalAccount.expenditure.reserves +
        mofData.specialAccount.expenditure.rsExcluded.total,
      rsTargetRate: 0,
    },
  };
  summary.overall.rsTargetRate =
    (summary.overall.rsTarget / summary.overall.total) * 100;

  return {
    metadata,
    sankey: { nodes, links },
    summary,
  };
}

/**
 * Column 1: 財源+特会ノード作成
 * 税収詳細（一般会計）+ 年金特会 + 労働保険特会 + その他特会
 * 並び順: 一般会計分を金額降順で上、その後に特会
 */
function createSourceNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];

  // 一般会計の歳入項目（金額降順でソート）
  const taxes = mofData.generalAccount.revenue.taxes;
  const THRESHOLD = 1_000_000_000_000; // 1兆円

  const generalAccountRevenues: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [
    {
      id: 'revenue-consumption-tax',
      name: '消費税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: taxes.consumptionTax,
      details: {
        taxType: '消費税' as const,
        description: '最大の税収源（34.2%）',
        amount: taxes.consumptionTax,
      },
    },
    {
      id: 'revenue-income-tax',
      name: '所得税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: taxes.incomeTax,
      details: {
        taxType: '所得税' as const,
        description: '個人所得への課税（30.7%）',
        amount: taxes.incomeTax,
      },
    },
    {
      id: 'revenue-corporate-tax',
      name: '法人税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: taxes.corporateTax,
      details: {
        taxType: '法人税' as const,
        description: '企業利益への課税（21.3%）',
        amount: taxes.corporateTax,
      },
    },
    {
      id: 'revenue-public-bonds',
      name: '公債金（国債）',
      type: 'public-bonds' as MOFBudgetNodeType,
      value: mofData.generalAccount.revenue.publicBonds,
      details: {
        description: '新規国債発行（将来世代の負担）',
        amount: mofData.generalAccount.revenue.publicBonds,
      },
    },
  ];

  // その他の税（1兆円以上を個別表示）
  const otherTaxItems: Array<{ id: string; name: import('@/types/mof-budget-overview').TaxType; value: number }> = [
    { id: 'inheritance-tax', name: '相続税', value: taxes.inheritanceTax },
    { id: 'gasoline-tax', name: '揮発油税', value: taxes.gasolineTax },
    { id: 'sake-tax', name: '酒税', value: taxes.sakeTax },
    { id: 'customs-duty', name: '関税', value: taxes.customsDuty },
    { id: 'tobacco-tax', name: 'たばこ税', value: taxes.tobaccoTax },
    { id: 'petroleum-coal-tax', name: '石油石炭税', value: taxes.petroleumCoalTax },
    { id: 'automobile-weight-tax', name: '自動車重量税', value: taxes.automobileWeightTax },
    { id: 'power-development-tax', name: '電源開発促進税', value: taxes.powerDevelopmentTax },
    { id: 'other-taxes', name: 'その他税', value: taxes.otherTaxes },
  ];

  let otherTaxesSum = 0;
  otherTaxItems.forEach(item => {
    if (item.value >= THRESHOLD) {
      generalAccountRevenues.push({
        id: `revenue-${item.id}`,
        name: item.name,
        type: 'tax-detail' as MOFBudgetNodeType,
        value: item.value,
        details: {
          taxType: item.name,
          description: `${item.name}（${(item.value / 1e12).toFixed(1)}兆円）`,
          amount: item.value,
        },
      });
    } else {
      otherTaxesSum += item.value;
    }
  });

  // 1兆円未満の税をまとめて「その他税」として追加
  if (otherTaxesSum > 0) {
    generalAccountRevenues.push({
      id: 'revenue-other-taxes',
      name: 'その他税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: otherTaxesSum,
      details: {
        taxType: 'その他税' as const,
        description: `その他税（${(otherTaxesSum / 1e12).toFixed(1)}兆円）`,
        amount: otherTaxesSum,
      },
    });
  }

  // 一般会計分を金額降順でソート、ただし「その他税」は最後に配置
  generalAccountRevenues.sort((a, b) => {
    // 「その他税」は常に最後
    if (a.name === 'その他税') return 1;
    if (b.name === 'その他税') return -1;
    // それ以外は金額降順
    return (b.value || 0) - (a.value || 0);
  });
  nodes.push(...generalAccountRevenues);

  // 特別会計ノード
  const accounts = mofData.specialAccount.expenditure.accounts;

  // 特別会計（1兆円以上を個別表示）
  // Note: accounts.othersは常に「その他特会」集約ノードに含める
  const otherSpecialAccounts = [
    { id: 'pension', name: '年金特会', data: accounts.pension },
    { id: 'labor', name: '労働保険特会', data: accounts.labor },
    { id: 'energy', name: 'エネ対策特会', data: accounts.energy },
    { id: 'food', name: '食料安定特会', data: accounts.food },
    { id: 'reconstruction', name: '復興特会', data: accounts.reconstruction },
    { id: 'forex', name: '外為特会', data: accounts.forex },
    { id: 'debt-retirement', name: '国債整理基金', data: accounts.debtRetirement },
    { id: 'allocation-tax', name: '交付税配付', data: accounts.allocationTax },
    { id: 'filp', name: '財政投融資', data: accounts.filp },
  ];

  // MOFデータの「その他特会」は常に集約ノードに含める
  let otherSpecialTotal = accounts.others.total;
  let otherSpecialRSTarget = accounts.others.rsTarget;
  let otherSpecialRSExcluded = accounts.others.rsExcluded;

  // 1兆円未満の特会を「その他特会」に集約
  const individualSpecialAccounts: typeof nodes = [];
  otherSpecialAccounts.forEach(acc => {
    if (acc.data.total >= THRESHOLD) {
      individualSpecialAccounts.push({
        id: `source-${acc.id}`,
        name: acc.name,
        type: 'account-type' as MOFBudgetNodeType,
        value: acc.data.total,
        details: {
          accountType: '特別会計',
          rsTargetAmount: acc.data.rsTarget,
          rsExcludedAmount: acc.data.rsExcluded,
          rsTargetRate: acc.data.total > 0 ? (acc.data.rsTarget / acc.data.total) * 100 : 0,
          description: `${acc.name}（${(acc.data.total / 1e12).toFixed(1)}兆円）`,
          amount: acc.data.total,
        },
      });
    } else {
      otherSpecialTotal += acc.data.total;
      otherSpecialRSTarget += acc.data.rsTarget;
      otherSpecialRSExcluded += acc.data.rsExcluded;
    }
  });

  // 特会ノードを金額降順でソート、ただし「その他特会」は最後に配置
  individualSpecialAccounts.sort((a, b) => (b.value || 0) - (a.value || 0));
  nodes.push(...individualSpecialAccounts);

  // 「その他特会」を最後に追加
  nodes.push({
    id: 'source-other-special',
    name: 'その他特会',
    type: 'account-type' as MOFBudgetNodeType,
    value: otherSpecialTotal,
    details: {
      accountType: '特別会計',
      rsTargetAmount: otherSpecialRSTarget,
      rsExcludedAmount: otherSpecialRSExcluded,
      rsTargetRate: otherSpecialTotal > 0 ? (otherSpecialRSTarget / otherSpecialTotal) * 100 : 0,
      description: `その他特会（${(otherSpecialTotal / 1e12).toFixed(1)}兆円）`,
      amount: otherSpecialTotal,
    },
  });

  return nodes;
}

/**
 * Column 2: 会計集約ノード作成
 * 一般会計 + 特別会計（集約）の2つのみ
 */
function createAccountAggregateNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];

  // 1. 一般会計
  const generalRSTarget = mofData.generalAccount.expenditure.rsTarget;
  const generalRSExcluded =
    mofData.generalAccount.expenditure.debtService +
    mofData.generalAccount.expenditure.localAllocationTax +
    mofData.generalAccount.expenditure.reserves;

  nodes.push({
    id: 'aggregate-general',
    name: '一般会計',
    type: 'account-type' as MOFBudgetNodeType,
    value: mofData.generalAccount.total,
    details: {
      accountType: '一般会計',
      rsTargetAmount: generalRSTarget,
      rsExcludedAmount: generalRSExcluded,
      rsTargetRate: (generalRSTarget / mofData.generalAccount.total) * 100,
      description: '国の基本的な予算（114.4兆円）',
      amount: mofData.generalAccount.total,
    },
  });

  // 2. 特別会計（集約）
  nodes.push({
    id: 'aggregate-special',
    name: '特別会計',
    type: 'account-type' as MOFBudgetNodeType,
    value: mofData.specialAccount.total,
    details: {
      accountType: '特別会計',
      rsTargetAmount: mofData.specialAccount.expenditure.rsTarget.total,
      rsExcludedAmount: mofData.specialAccount.expenditure.rsExcluded.total,
      rsTargetRate:
        (mofData.specialAccount.expenditure.rsTarget.total / mofData.specialAccount.total) * 100,
      description: `特別会計統合（${(mofData.specialAccount.total / 1e12).toFixed(1)}兆円）`,
      amount: mofData.specialAccount.total,
    },
  });

  return nodes;
}

/**
 * Column 3: 会計詳細ノード作成
 * 一般会計（パススルー） + 主要特別会計（年金、労働保険）+ その他統合
 */
function createAccountDetailNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];

  // 1. 一般会計
  const generalRSTarget = mofData.generalAccount.expenditure.rsTarget;
  const generalRSExcluded =
    mofData.generalAccount.expenditure.debtService +
    mofData.generalAccount.expenditure.localAllocationTax +
    mofData.generalAccount.expenditure.reserves;

  nodes.push({
    id: 'account-general',
    name: '一般会計',
    type: 'account-type' as MOFBudgetNodeType,
    value: mofData.generalAccount.total,
    details: {
      accountType: '一般会計',
      rsTargetAmount: generalRSTarget,
      rsExcludedAmount: generalRSExcluded,
      rsTargetRate: (generalRSTarget / mofData.generalAccount.total) * 100,
      description: '国の基本的な予算（114.4兆円）',
      amount: mofData.generalAccount.total,
    },
  });

  // 2. 年金特別会計（独立表示）
  const accounts = mofData.specialAccount.expenditure.accounts;
  nodes.push({
    id: 'account-pension',
    name: '年金特会',
    type: 'account-type' as MOFBudgetNodeType,
    value: accounts.pension.total,
    details: {
      accountType: '特別会計',
      rsTargetAmount: accounts.pension.rsTarget,
      rsExcludedAmount: accounts.pension.rsExcluded,
      rsTargetRate: (accounts.pension.rsTarget / accounts.pension.total) * 100,
      description: `年金特会（${(accounts.pension.total / 1e12).toFixed(1)}兆円）`,
      amount: accounts.pension.total,
    },
  });

  // 3. 労働保険特別会計（独立表示）
  nodes.push({
    id: 'account-labor',
    name: '労働保険特会',
    type: 'account-type' as MOFBudgetNodeType,
    value: accounts.labor.total,
    details: {
      accountType: '特別会計',
      rsTargetAmount: accounts.labor.rsTarget,
      rsExcludedAmount: accounts.labor.rsExcluded,
      rsTargetRate: (accounts.labor.rsTarget / accounts.labor.total) * 100,
      description: `労働保険特会（${(accounts.labor.total / 1e12).toFixed(1)}兆円）`,
      amount: accounts.labor.total,
    },
  });

  // 4. その他特別会計（統合）
  const otherTotal =
    accounts.energy.total +
    accounts.food.total +
    accounts.reconstruction.total +
    accounts.forex.total +
    accounts.debtRetirement.total +
    accounts.allocationTax.total +
    accounts.filp.total +
    accounts.others.total;

  const otherRSTarget =
    accounts.energy.rsTarget +
    accounts.food.rsTarget +
    accounts.reconstruction.rsTarget +
    accounts.forex.rsTarget +
    accounts.debtRetirement.rsTarget +
    accounts.allocationTax.rsTarget +
    accounts.filp.rsTarget +
    accounts.others.rsTarget;

  const otherRSExcluded =
    accounts.energy.rsExcluded +
    accounts.food.rsExcluded +
    accounts.reconstruction.rsExcluded +
    accounts.forex.rsExcluded +
    accounts.debtRetirement.rsExcluded +
    accounts.allocationTax.rsExcluded +
    accounts.filp.rsExcluded +
    accounts.others.rsExcluded;

  nodes.push({
    id: 'account-other-special',
    name: 'その他特会',
    type: 'account-type' as MOFBudgetNodeType,
    value: otherTotal,
    details: {
      accountType: '特別会計',
      rsTargetAmount: otherRSTarget,
      rsExcludedAmount: otherRSExcluded,
      rsTargetRate: otherTotal > 0 ? (otherRSTarget / otherTotal) * 100 : 0,
      description: `その他特会統合（${(otherTotal / 1e12).toFixed(1)}兆円）`,
      amount: otherTotal,
    },
  });

  return nodes;
}

/**
 * Column 3: RS対象区分ノード作成
 * 並び順: RS対象を上に配置（一般会計RS対象、特別会計RS対象、一般会計RS対象外、特別会計RS対象外）
 */
function createRSCategoryNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  return [
    // RS対象（上側）
    {
      id: 'rs-category-general-target',
      name: '一般会計RS対象',
      type: 'rs-category' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.rsTarget,
      details: {
        category: 'RS対象',
        parentAccount: '一般会計',
        description: '事業として計上された予算（63.4%）',
        amount: mofData.generalAccount.expenditure.rsTarget,
      },
    },
    {
      id: 'rs-category-special-target',
      name: '特別会計RS対象',
      type: 'rs-category' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.rsTarget.total,
      details: {
        category: 'RS対象',
        parentAccount: '特別会計',
        description: '年金・労働保険等の事業（17.8%）',
        amount: mofData.specialAccount.expenditure.rsTarget.total,
      },
    },
    // RS対象外（下側）
    {
      id: 'rs-category-general-excluded',
      name: '一般会計RS対象外',
      type: 'rs-category' as MOFBudgetNodeType,
      value:
        mofData.generalAccount.expenditure.debtService +
        mofData.generalAccount.expenditure.localAllocationTax +
        mofData.generalAccount.expenditure.reserves,
      details: {
        category: 'RS対象外',
        parentAccount: '一般会計',
        description: '国債費・地方交付税等（36.6%）',
        amount:
          mofData.generalAccount.expenditure.debtService +
          mofData.generalAccount.expenditure.localAllocationTax +
          mofData.generalAccount.expenditure.reserves,
      },
    },
    {
      id: 'rs-category-special-excluded',
      name: '特別会計RS対象外',
      type: 'rs-category' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.rsExcluded.total,
      details: {
        category: 'RS対象外',
        parentAccount: '特別会計',
        description: '国債整理・地方交付税配付金等（82.2%）',
        amount: mofData.specialAccount.expenditure.rsExcluded.total,
      },
    },
  ];
}

/**
 * Column 4: 詳細内訳ノード作成
 * 並び順: RS対象を上に配置（一般会計事業、特別会計事業たち、一般会計RS対象外たち、特別会計RS対象外たち）
 */
function createBudgetDetailNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  return [
    // RS対象（上側）- 一般会計
    {
      id: 'detail-general-projects',
      name: '一般会計事業',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.rsTarget,
      details: {
        detailType: '一般会計事業',
        isRSTarget: true,
        description: '各府省庁の事業予算',
        amount: mofData.generalAccount.expenditure.rsTarget,
      },
    },
    // RS対象（上側）- 特別会計
    {
      id: 'detail-pension-projects',
      name: '年金事業',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.pension.rsTarget,
      details: {
        detailType: '年金事業',
        isRSTarget: true,
        description: '年金制度の運営',
        amount: mofData.specialAccount.expenditure.accounts.pension.rsTarget,
      },
    },
    {
      id: 'detail-labor-projects',
      name: '労働保険',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.labor.rsTarget,
      details: {
        detailType: '労働保険',
        isRSTarget: true,
        description: '雇用保険・労災保険',
        amount: mofData.specialAccount.expenditure.accounts.labor.rsTarget,
      },
    },
    {
      id: 'detail-other-projects',
      name: 'その他事業',
      type: 'budget-detail' as MOFBudgetNodeType,
      value:
        mofData.specialAccount.expenditure.accounts.energy.rsTarget +
        mofData.specialAccount.expenditure.accounts.food.rsTarget +
        mofData.specialAccount.expenditure.accounts.reconstruction.rsTarget +
        mofData.specialAccount.expenditure.accounts.others.rsTarget,
      details: {
        detailType: 'その他事業',
        isRSTarget: true,
        description: 'エネルギー対策、食料安定等',
        amount:
          mofData.specialAccount.expenditure.accounts.energy.rsTarget +
          mofData.specialAccount.expenditure.accounts.food.rsTarget +
          mofData.specialAccount.expenditure.accounts.reconstruction.rsTarget +
          mofData.specialAccount.expenditure.accounts.others.rsTarget,
      },
    },
    // RS対象外（下側）- 一般会計
    {
      id: 'detail-debt-service',
      name: '国債費',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.debtService,
      details: {
        detailType: '国債費',
        isRSTarget: false,
        description: '国債の利払い・償還',
        amount: mofData.generalAccount.expenditure.debtService,
      },
    },
    {
      id: 'detail-local-allocation-tax',
      name: '地方交付税',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.localAllocationTax,
      details: {
        detailType: '地方交付税',
        isRSTarget: false,
        description: '地方自治体への財源移転',
        amount: mofData.generalAccount.expenditure.localAllocationTax,
      },
    },
    // RS対象外（下側）- 特別会計
    {
      id: 'detail-debt-retirement',
      name: '国債整理基金',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.debtRetirement.rsExcluded,
      details: {
        detailType: '国債整理基金',
        isRSTarget: false,
        description: '借換債が大部分',
        amount: mofData.specialAccount.expenditure.accounts.debtRetirement.rsExcluded,
      },
    },
    {
      id: 'detail-local-allocation-distribution',
      name: '地方交付税配付金',
      type: 'budget-detail' as MOFBudgetNodeType,
      value:
        mofData.specialAccount.expenditure.accounts.allocationTax.rsExcluded,
      details: {
        detailType: '地方交付税配付金',
        isRSTarget: false,
        description: '特別会計からの配付',
        amount:
          mofData.specialAccount.expenditure.accounts.allocationTax.rsExcluded,
      },
    },
    {
      id: 'detail-fiscal-investment-loan',
      name: '財政投融資',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.filp.rsExcluded,
      details: {
        detailType: '財政投融資',
        isRSTarget: false,
        description: '融資・投資活動',
        amount:
          mofData.specialAccount.expenditure.accounts.filp.rsExcluded,
      },
    },
    {
      id: 'detail-pension-benefits',
      name: '年金給付等',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.pension.rsExcluded,
      details: {
        detailType: '年金給付等',
        isRSTarget: false,
        description: '受給者への給付',
        amount: mofData.specialAccount.expenditure.accounts.pension.rsExcluded,
      },
    },
    {
      id: 'detail-other-excluded',
      name: 'その他対象外',
      type: 'budget-detail' as MOFBudgetNodeType,
      value:
        mofData.specialAccount.expenditure.accounts.labor.rsExcluded +
        mofData.specialAccount.expenditure.accounts.energy.rsExcluded +
        mofData.specialAccount.expenditure.accounts.food.rsExcluded +
        mofData.specialAccount.expenditure.accounts.reconstruction.rsExcluded +
        mofData.specialAccount.expenditure.accounts.forex.rsExcluded +
        mofData.specialAccount.expenditure.accounts.others.rsExcluded +
        mofData.generalAccount.expenditure.reserves,
      details: {
        detailType: 'その他',
        isRSTarget: false,
        description: '予備費、外為特会等',
        amount:
          mofData.specialAccount.expenditure.accounts.labor.rsExcluded +
          mofData.specialAccount.expenditure.accounts.energy.rsExcluded +
          mofData.specialAccount.expenditure.accounts.food.rsExcluded +
          mofData.specialAccount.expenditure.accounts.reconstruction.rsExcluded +
          mofData.specialAccount.expenditure.accounts.forex.rsExcluded +
          mofData.specialAccount.expenditure.accounts.others.rsExcluded +
          mofData.generalAccount.expenditure.reserves,
      },
    },
  ];
}

/**
 * Column 5: RS集約ノード作成
 */
function createRSSummaryNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const rsTargetTotal =
    mofData.generalAccount.expenditure.rsTarget +
    mofData.specialAccount.expenditure.rsTarget.total;

  const rsExcludedTotal =
    mofData.generalAccount.expenditure.debtService +
    mofData.generalAccount.expenditure.localAllocationTax +
    mofData.generalAccount.expenditure.reserves +
    mofData.specialAccount.expenditure.rsExcluded.total;

  return [
    {
      id: 'summary-rs-target',
      name: 'RSシステム対象',
      type: 'rs-summary' as MOFBudgetNodeType,
      value: rsTargetTotal,
      details: {
        description: '事業レビュー対象（27.2%）',
        amount: rsTargetTotal,
      },
    },
    {
      id: 'summary-rs-excluded',
      name: 'RS対象外',
      type: 'rs-summary' as MOFBudgetNodeType,
      value: rsExcludedTotal,
      details: {
        description: '制度的支出・給付型支出（72.8%）',
        amount: rsExcludedTotal,
      },
    },
  ];
}

/**
 * Column 1 → Column 2 のリンク作成
 * 税収・公債金 → 一般会計、年金特会等 → 特別会計（集約）
 */
function createSourceToAggregateLinks(
  sourceNodes: SankeyNode[],
  accountAggregateNodes: SankeyNode[],
  _mofData: MOFBudgetData
): SankeyLink[] {
  const links: SankeyLink[] = [];
  const generalAggregate = accountAggregateNodes.find((n) => n.id === 'aggregate-general')!;
  const specialAggregate = accountAggregateNodes.find((n) => n.id === 'aggregate-special')!;

  sourceNodes.forEach(node => {
    // 税収・公債金 → 一般会計
    if (node.type === 'tax-detail' || node.type === 'public-bonds') {
      links.push({ source: node.id, target: generalAggregate.id, value: node.value || 0 });
    }
    // 特会 → 特別会計（集約）
    else if (node.type === 'account-type') {
      links.push({ source: node.id, target: specialAggregate.id, value: node.value || 0 });
    }
  });

  return links;
}

/**
 * Column 2 → Column 3 のリンク作成
 * 会計集約 → RS対象区分
 */
function createAggregateToRSCategoryLinks(
  accountAggregateNodes: SankeyNode[],
  rsCategoryNodes: SankeyNode[],
  _mofData: MOFBudgetData
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const generalAggregate = accountAggregateNodes.find((n) => n.id === 'aggregate-general')!;
  const specialAggregate = accountAggregateNodes.find((n) => n.id === 'aggregate-special')!;

  const generalTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-target'
  )!;
  const generalExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-excluded'
  )!;
  const specialTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-target'
  )!;
  const specialExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-excluded'
  )!;

  // 一般会計（集約）→ RS対象/対象外
  links.push(
    {
      source: generalAggregate.id,
      target: generalTarget.id,
      value: generalTarget.value || 0,
    },
    {
      source: generalAggregate.id,
      target: generalExcluded.id,
      value: generalExcluded.value || 0,
    }
  );

  // 特別会計（集約）→ RS対象/対象外
  links.push(
    {
      source: specialAggregate.id,
      target: specialTarget.id,
      value: specialTarget.value || 0,
    },
    {
      source: specialAggregate.id,
      target: specialExcluded.id,
      value: specialExcluded.value || 0,
    }
  );

  return links;
}

/**
 * RS対象区分 → 詳細内訳 のリンク作成
 */
function createRSCategoryToDetailLinks(
  rsCategoryNodes: SankeyNode[],
  detailNodes: SankeyNode[]
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const generalTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-target'
  )!;
  const generalExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-excluded'
  )!;
  const specialTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-target'
  )!;
  const specialExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-excluded'
  )!;

  // 一般会計RS対象 → 一般会計事業
  const generalProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-general-projects'
  )!;
  links.push({
    source: generalTarget.id,
    target: generalProjectsNode.id,
    value: generalProjectsNode.value || 0,
  });

  // 一般会計RS対象外 → 国債費、地方交付税
  const debtServiceNode = detailNodes.find(
    (n) => n.id === 'detail-debt-service'
  )!;
  const localAllocationTaxNode = detailNodes.find(
    (n) => n.id === 'detail-local-allocation-tax'
  )!;
  links.push(
    {
      source: generalExcluded.id,
      target: debtServiceNode.id,
      value: debtServiceNode.value || 0,
    },
    {
      source: generalExcluded.id,
      target: localAllocationTaxNode.id,
      value: localAllocationTaxNode.value || 0,
    }
  );

  // 特別会計RS対象 → 年金事業、労働保険、その他事業
  const pensionProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-pension-projects'
  )!;
  const laborProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-labor-projects'
  )!;
  const otherProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-other-projects'
  )!;
  links.push(
    {
      source: specialTarget.id,
      target: pensionProjectsNode.id,
      value: pensionProjectsNode.value || 0,
    },
    {
      source: specialTarget.id,
      target: laborProjectsNode.id,
      value: laborProjectsNode.value || 0,
    },
    {
      source: specialTarget.id,
      target: otherProjectsNode.id,
      value: otherProjectsNode.value || 0,
    }
  );

  // 特別会計RS対象外 → 各種詳細ノード
  // Note: Linking from Special Excluded Category node to Detailed nodes
  // Logic: specialExcluded -> Debt, Allocation, FILP, PensionBenefits, Others.

  const debtRetirementNode = detailNodes.find(
    (n) => n.id === 'detail-debt-retirement'
  )!;
  const localAllocationDistributionNode = detailNodes.find(
    (n) => n.id === 'detail-local-allocation-distribution'
  )!;
  const fiscalInvestmentLoanNode = detailNodes.find(
    (n) => n.id === 'detail-fiscal-investment-loan'
  )!;
  const pensionBenefitsNode = detailNodes.find(
    (n) => n.id === 'detail-pension-benefits'
  )!;
  const otherExcludedNode = detailNodes.find(
    (n) => n.id === 'detail-other-excluded'
  )!;

  links.push(
    {
      source: specialExcluded.id,
      target: debtRetirementNode.id,
      value: debtRetirementNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: localAllocationDistributionNode.id,
      value: localAllocationDistributionNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: fiscalInvestmentLoanNode.id,
      value: fiscalInvestmentLoanNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: pensionBenefitsNode.id,
      value: pensionBenefitsNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: otherExcludedNode.id,
      value: otherExcludedNode.value || 0,
    }
  );

  return links;
}

/**
 * 詳細内訳 → RS集約 のリンク作成
 */
function createDetailToSummaryLinks(
  detailNodes: SankeyNode[],
  summaryNodes: SankeyNode[]
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const rsTargetSummary = summaryNodes.find(
    (n) => n.id === 'summary-rs-target'
  )!;
  const rsExcludedSummary = summaryNodes.find(
    (n) => n.id === 'summary-rs-excluded'
  )!;

  detailNodes.forEach((detailNode) => {
    const details = (detailNode as SankeyNode & { details?: MOFBudgetNodeDetails }).details;
    if (details) {
      const target = details.isRSTarget ? rsTargetSummary : rsExcludedSummary;
      links.push({
        source: detailNode.id,
        target: target.id,
        value: detailNode.value || 0,
      });
    }
  });

  return links;
}
