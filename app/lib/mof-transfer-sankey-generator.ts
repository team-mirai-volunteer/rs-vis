/**
 * MOF特別会計財源内訳サンキー図生成器
 */

import type { MOFBudgetData } from '@/types/mof-budget-overview';
import type { TransferFromGeneralAccount } from '@/types/mof-transfer';
import type { SankeyNode, SankeyLink } from '@/types/sankey';

/**
 * 特別会計443.43兆円の財源内訳を可視化するサンキー図データを生成
 *
 * 構成:
 * - Column 1 (左): 財源詳細（一般会計繰入の内訳、社会保険料の内訳等）
 * - Column 2 (中): 財源カテゴリ（一般会計繰入、社会保険料、公債金等）
 * - Column 3 (右): 特別会計総額 443.43兆円
 */
export function generateTransferDetailSankey(mofData: MOFBudgetData): {
  nodes: SankeyNode[];
  links: SankeyLink[];
} {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  const transfer = mofData.specialAccount.revenue.transferFromGeneral;
  const insurancePremiums = mofData.specialAccount.revenue.insurancePremiums;

  // 型チェック: 詳細データが利用可能か確認
  const hasDetailedTransfer = typeof transfer !== 'number';
  const transferDetail = hasDetailedTransfer ? (transfer as TransferFromGeneralAccount) : null;

  // Column 1 (左): 財源詳細
  if (transferDetail) {
    // 一般会計繰入の詳細内訳
    nodes.push({
      id: 'transfer-pension',
      name: '年金特会へ繰入',
      value: transferDetail.breakdown.pension.total,
      type: 'transfer-detail',
    });

    nodes.push({
      id: 'transfer-local',
      name: '交付税配付金へ繰入',
      value: transferDetail.breakdown.localAllocationTax.total,
      type: 'transfer-detail',
    });

    nodes.push({
      id: 'transfer-debt',
      name: '国債整理基金へ繰入',
      value: transferDetail.breakdown.debtRetirement.total,
      type: 'transfer-detail',
    });

    nodes.push({
      id: 'transfer-energy',
      name: 'エネルギー対策へ繰入',
      value: transferDetail.breakdown.energy.total,
      type: 'transfer-detail',
    });

    const otherTransferTotal =
      transferDetail.breakdown.foodSupply +
      transferDetail.breakdown.laborInsurance +
      transferDetail.breakdown.automotiveSafety +
      transferDetail.breakdown.reconstruction +
      transferDetail.breakdown.forestryDebtManagement +
      transferDetail.breakdown.patent;

    if (otherTransferTotal > 0) {
      nodes.push({
        id: 'transfer-other',
        name: 'その他特会へ繰入',
        value: otherTransferTotal,
        type: 'transfer-detail',
      });
    }
  }

  // 社会保険料の内訳
  if (typeof insurancePremiums === 'object' && 'pension' in insurancePremiums) {
    nodes.push({
      id: 'insurance-pension',
      name: '年金保険料',
      value: insurancePremiums.pension,
      type: 'insurance-detail',
    });

    nodes.push({
      id: 'insurance-labor',
      name: '労働保険料',
      value: insurancePremiums.labor,
      type: 'insurance-detail',
    });

    nodes.push({
      id: 'insurance-other',
      name: 'その他保険料',
      value: insurancePremiums.other,
      type: 'insurance-detail',
    });
  }

  // Column 2 (中): 財源カテゴリ
  const transferTotal = transferDetail ? transferDetail.totalIncludingDebt : (typeof transfer === 'number' ? transfer : 0);
  const insuranceTotal = typeof insurancePremiums === 'object' && 'total' in insurancePremiums ? insurancePremiums.total : 0;

  nodes.push({
    id: 'category-transfer',
    name: '一般会計繰入',
    value: transferTotal,
    type: 'revenue-category',
  });

  nodes.push({
    id: 'category-insurance',
    name: '社会保険料',
    value: insuranceTotal,
    type: 'revenue-category',
  });

  nodes.push({
    id: 'category-bonds',
    name: '公債金（借換債）',
    value: mofData.specialAccount.revenue.publicBonds,
    type: 'revenue-category',
  });

  const transferFromOther = mofData.specialAccount.revenue.transferFromOther;
  nodes.push({
    id: 'category-other-transfer',
    name: '他会計繰入',
    value: typeof transferFromOther === 'number' ? transferFromOther : transferFromOther.total,
    type: 'revenue-category',
  });

  nodes.push({
    id: 'category-other-revenue',
    name: 'その他収入',
    value: mofData.specialAccount.revenue.other,
    type: 'revenue-category',
  });

  // Column 3 (右): 特別会計総額
  nodes.push({
    id: 'special-account-total',
    name: '特別会計',
    value: mofData.specialAccount.total,
    type: 'account-total',
  });

  // リンク作成
  // Column 1 → Column 2
  if (transferDetail) {
    links.push({
      source: 'transfer-pension',
      target: 'category-transfer',
      value: transferDetail.breakdown.pension.total,
    });

    links.push({
      source: 'transfer-local',
      target: 'category-transfer',
      value: transferDetail.breakdown.localAllocationTax.total,
    });

    links.push({
      source: 'transfer-debt',
      target: 'category-transfer',
      value: transferDetail.breakdown.debtRetirement.total,
    });

    links.push({
      source: 'transfer-energy',
      target: 'category-transfer',
      value: transferDetail.breakdown.energy.total,
    });

    const otherTransferTotal =
      transferDetail.breakdown.foodSupply +
      transferDetail.breakdown.laborInsurance +
      transferDetail.breakdown.automotiveSafety +
      transferDetail.breakdown.reconstruction +
      transferDetail.breakdown.forestryDebtManagement +
      transferDetail.breakdown.patent;

    if (otherTransferTotal > 0) {
      links.push({
        source: 'transfer-other',
        target: 'category-transfer',
        value: otherTransferTotal,
      });
    }
  }

  if (typeof insurancePremiums === 'object' && 'pension' in insurancePremiums) {
    links.push({
      source: 'insurance-pension',
      target: 'category-insurance',
      value: insurancePremiums.pension,
    });

    links.push({
      source: 'insurance-labor',
      target: 'category-insurance',
      value: insurancePremiums.labor,
    });

    links.push({
      source: 'insurance-other',
      target: 'category-insurance',
      value: insurancePremiums.other,
    });
  }

  // Column 2 → Column 3
  links.push({
    source: 'category-transfer',
    target: 'special-account-total',
    value: transferTotal,
  });

  links.push({
    source: 'category-insurance',
    target: 'special-account-total',
    value: insuranceTotal,
  });

  links.push({
    source: 'category-bonds',
    target: 'special-account-total',
    value: mofData.specialAccount.revenue.publicBonds,
  });

  links.push({
    source: 'category-other-transfer',
    target: 'special-account-total',
    value: typeof transferFromOther === 'number' ? transferFromOther : transferFromOther.total,
  });

  links.push({
    source: 'category-other-revenue',
    target: 'special-account-total',
    value: mofData.specialAccount.revenue.other,
  });

  return { nodes, links };
}
