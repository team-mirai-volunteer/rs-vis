/**
 * 特別会計の財源内訳ビューのサンキー生成。
 *
 * 「その特別会計は自前の財源で回っているのか、一般会計から回ってきた金を
 * 通しているだけなのか」を会計ごとに見えるようにする。
 * 集計 JSON からノードとリンクを組む純粋関数（HTTP・ファイル読み込みはしない）。
 */

import type {
  MOFAccountFunding,
  MOFTransferDetailData,
  MOFTransferFlow,
} from '@/types/mof-transfer';
import type { MOFBudgetNodeDetails, MOFBudgetOverview } from '@/types/mof-budget-overview';
import type { SankeyNode, SankeyLink } from '@/types/sankey';

type Node = SankeyNode & { details?: MOFBudgetNodeDetails };

/** 財源の種別 */
const SOURCE_GENERAL = 'fund-from-general';
const SOURCE_OTHER = 'fund-from-other';
const SOURCE_OWN = 'fund-own';

/** 集計 JSON から特別会計の財源内訳を組み立てる */
export function generateTransferDetailSankey(
  data: MOFBudgetOverview
): MOFTransferDetailData {
  const nodes: Node[] = [];
  const links: SankeyLink[] = [];

  const reconciliation = new Map(
    data.transfers.reconciliation.map(r => [r.account, r])
  );

  const funding: MOFAccountFunding[] = data.specialAccounts.accounts
    .filter(a => a.revenue > 0)
    .map(a => ({
      account: a.name,
      revenue: a.revenue,
      transferIn: a.transferIn,
      ownRevenue: a.revenue - a.transferIn,
      ownRevenueRate: a.ownRevenueRate,
      byCategory: [],
    }))
    .sort((x, y) => y.revenue - x.revenue);

  let fromGeneralTotal = 0;
  let fromOtherTotal = 0;
  let ownTotal = 0;

  for (const account of funding) {
    const recon = reconciliation.get(account.account);
    const fromGeneral = Math.min(recon?.fromGeneral ?? 0, account.transferIn);
    // 受入のうち一般会計から説明できない分は他の特別会計から来たものとして扱う
    const fromOther = Math.max(account.transferIn - fromGeneral, 0);

    const id = `sa-${account.account}`;
    nodes.push({
      id,
      name: account.account,
      value: account.revenue,
      type: 'account',
      details: {
        nodeType: 'account',
        accountKind: 'special',
        description: `自前財源比率 ${(account.ownRevenueRate * 100).toFixed(1)}%`,
      },
    } as Node);

    if (fromGeneral > 0) {
      links.push({ source: SOURCE_GENERAL, target: id, value: fromGeneral });
      fromGeneralTotal += fromGeneral;
    }
    if (fromOther > 0) {
      links.push({ source: SOURCE_OTHER, target: id, value: fromOther });
      fromOtherTotal += fromOther;
    }
    if (account.ownRevenue > 0) {
      links.push({ source: SOURCE_OWN, target: id, value: account.ownRevenue });
      ownTotal += account.ownRevenue;
    }
  }

  const sourceNodes: Array<[string, string, number, string]> = [
    [
      SOURCE_GENERAL,
      '一般会計からの繰入',
      fromGeneralTotal,
      '一般会計の歳出（使途別分類コード6）から回ってきた分',
    ],
    [
      SOURCE_OTHER,
      '他の特別会計からの繰入',
      fromOtherTotal,
      '受入のうち一般会計からの繰入で説明できない分',
    ],
    [SOURCE_OWN, '自前財源', ownTotal, '保険料・公債金・運用収入など、その会計自身の歳入'],
  ];

  for (const [id, name, value, description] of sourceNodes) {
    if (value <= 0) continue;
    nodes.unshift({
      id,
      name,
      value,
      type: 'source',
      details: {
        nodeType: 'source',
        accountKind: 'special',
        isDeduction: id !== SOURCE_OWN,
        description,
      },
    } as Node);
  }

  const flows: MOFTransferFlow[] = data.generalAccount.expenditure.transfersByDestination.map(
    t => ({
      from: '一般会計',
      to:
        data.specialAccounts.accounts.find(a => t.name.includes(`${a.name}特別会計`))?.name ??
        t.name,
      label: t.name,
      amount: t.amount,
    })
  );

  return {
    metadata: { ...data.metadata, receivedTotal: data.transfers.receivedBySpecial },
    sankey: { nodes, links: links.filter(l => l.value > 0) },
    funding,
    flows,
  };
}
