/**
 * MOF 予算全体ビューのサンキー生成。
 *
 * 集計 JSON（`MOFBudgetOverview`）からノードとリンクを組む純粋関数。
 * HTTP アクセスやファイル読み込みはしない（読み込みは API 層の責務）。
 *
 * 図の骨格は「財源 → 会計 → 使途」の3段。会計間の繰入は
 * **一般会計 → 特別会計 のリンク**として明示し、二重計上される分が
 * どこで発生しているかを画面から読めるようにする。
 *
 * 会計ノードの値は歳入合計で揃える。歳出が歳入を下回る差額は
 * 「歳入超過」ノードで受け、フローを閉じる（辻褄合わせの項目を作らない）。
 */

import type {
  MOFAmountGroup,
  MOFBudgetNodeDetails,
  MOFBudgetOverview,
  MOFBudgetOverviewData,
} from '@/types/mof-budget-overview';
import type { SankeyNode, SankeyLink } from '@/types/sankey';

type Node = SankeyNode & { details?: MOFBudgetNodeDetails };

/** 財源ノードとして独立させる下限。これ未満は「その他」にまとめる */
const SOURCE_MIN_RATIO = 0.01;

/**
 * 財源ノードの最大数。
 * 閾値だけだと年度により20本を超え、ラベルが縦に潰れて読めなくなる。
 */
const SOURCE_MAX_NODES = 8;

/** 特別会計からの受入が計上される款。目名から款を特定できないときの寄せ先 */
const MISC_CATEGORY = '諸収入';

/** 会計ノードのID */
const ACCOUNT_IDS = {
  general: 'account-general',
  special: 'account-special',
  agency: 'account-agency',
} as const;

function node(
  id: string,
  name: string,
  value: number,
  details: MOFBudgetNodeDetails
): Node {
  return { id, name, value, type: details.nodeType, details } as Node;
}

/**
 * 内訳を「独立させるもの」と「その他にまとめるもの」に分ける。
 * 税目や款は年度により増減するため、閾値で機械的に決める（固定表を持たない）。
 */
function splitByRatio(
  groups: MOFAmountGroup[],
  total: number,
  maxNodes = SOURCE_MAX_NODES
): { major: MOFAmountGroup[]; othersAmount: number } {
  const major: MOFAmountGroup[] = [];
  let othersAmount = 0;
  for (const g of [...groups].sort((a, b) => b.amount - a.amount)) {
    if (g.amount <= 0) continue;
    const big = total > 0 && g.amount / total >= SOURCE_MIN_RATIO;
    if (big && major.length < maxNodes) major.push(g);
    else othersAmount += g.amount;
  }
  return { major, othersAmount };
}

/**
 * 一般会計の財源。
 *
 * 租税だけは税目まで下ろす（現行画面が税目別を出しており後退させないため）。
 * 特別会計からの受入は独立させる。逆方向の繰入が存在することを図で示すため。
 */
function generalSources(data: MOFBudgetOverview): { nodes: Node[]; links: SankeyLink[] } {
  const nodes: Node[] = [];
  const links: SankeyLink[] = [];
  const revenue = data.generalAccount.revenue;

  const push = (id: string, name: string, amount: number, details: MOFBudgetNodeDetails) => {
    if (amount <= 0) return;
    nodes.push(node(id, name, amount, details));
    links.push({ source: id, target: ACCOUNT_IDS.general, value: amount });
  };

  // 租税は税目別
  const taxTotal = revenue.byCategory.find(c => c.name === '租税')?.amount ?? 0;
  const { major: taxes, othersAmount: otherTaxes } = splitByRatio(revenue.taxes, taxTotal, 6);
  for (const tax of taxes) {
    push(`src-tax-${tax.name}`, tax.name, tax.amount, {
      nodeType: 'source',
      accountKind: 'general',
      description: '一般会計の租税',
    });
  }
  push('src-tax-other', 'その他の租税', otherTaxes, {
    nodeType: 'source',
    accountKind: 'general',
    description: '一般会計の租税（少額の税目をまとめたもの）',
  });

  // 租税以外の款。
  //
  // 特別会計からの受入は款「諸収入」等に含まれるので、**分割前に**差し引いておく。
  // 分割後に major の中だけで引くと、その款が少額で「その他」に落ちたときに
  // 受入が二重に数えられ、一般会計への流入が歳入合計を超える。
  const fromSpecialTotal = data.transfers.specialToGeneral;
  const fromSpecialByCategory = new Map<string, number>();
  for (const item of revenue.fromSpecialAccounts) {
    const category = revenue.byCategory.find(c => c.name === item.name);
    // fromSpecialAccounts は目名なので、款は「諸収入」等に含まれる想定。
    // 款名と一致しない限りは諸収入に寄せる（款別の内訳を持たないため）
    const key = category ? category.name : MISC_CATEGORY;
    fromSpecialByCategory.set(key, (fromSpecialByCategory.get(key) ?? 0) + item.amount);
  }
  const others = revenue.byCategory
    .filter(c => c.name !== '租税')
    .map(c => ({
      name: c.name,
      amount: Math.max(c.amount - (fromSpecialByCategory.get(c.name) ?? 0), 0),
    }));
  const { major, othersAmount } = splitByRatio(others, revenue.total);
  for (const category of major) {
    push(`src-general-${category.name}`, category.name, category.amount, {
      nodeType: 'source',
      accountKind: 'general',
      description: `一般会計の歳入（款: ${category.name}）`,
    });
  }
  push('src-general-other', 'その他の歳入', othersAmount, {
    nodeType: 'source',
    accountKind: 'general',
    description: '一般会計の歳入（少額の款をまとめたもの）',
  });

  push('src-from-special', '特別会計からの受入', fromSpecialTotal, {
    nodeType: 'source',
    accountKind: 'general',
    breakdown: data.transfers.specialToGeneralDetail,
    description:
      '特別会計の剰余金等が一般会計に入るもの。歳出予算には載らず、一般会計歳入の「◯◯特別会計受入金」にのみ現れる',
  });

  return { nodes, links };
}

/**
 * 特別会計の財源。
 *
 * 款「他会計より受入」は一般会計からの繰入と重複するため財源には出さず、
 * 一般会計 → 特別会計 のリンクで表現する。
 */
function specialSources(data: MOFBudgetOverview): { nodes: Node[]; links: SankeyLink[] } {
  const nodes: Node[] = [];
  const links: SankeyLink[] = [];
  const revenue = data.specialAccounts.revenue;

  // 自前財源は行単位で受入を除いたもの。年金特会は「一般会計より受入」が
  // 款「保険収入」の下にあり、款で除くと受入が自前財源に混ざる
  const own = revenue.own;
  const { major, othersAmount } = splitByRatio(own.byCategory, own.total);

  const push = (id: string, name: string, amount: number, description: string) => {
    if (amount <= 0) return;
    nodes.push(
      node(id, name, amount, { nodeType: 'source', accountKind: 'special', description })
    );
    links.push({ source: id, target: ACCOUNT_IDS.special, value: amount });
  };

  for (const category of major) {
    // 一般会計側の款と名前が重なる（公債金・租税など）ので会計を添えて区別する
    push(
      `src-special-${category.name}`,
      `${category.name}（特会）`,
      category.amount,
      `特別会計の自前財源（款: ${category.name}）`
    );
  }
  push(
    'src-special-other',
    'その他の特会歳入',
    othersAmount,
    '特別会計の自前財源（少額の款をまとめたもの）'
  );

  return { nodes, links };
}

/** 政府関係機関の財源。収入をまとめて1ノードにする（規模が小さく内訳の情報量が乏しいため） */
function agencySources(data: MOFBudgetOverview): { nodes: Node[]; links: SankeyLink[] } {
  const revenue = data.agencies.revenue.total;
  const expenditure = data.agencies.expenditure.total;
  if (expenditure <= 0) return { nodes: [], links: [] };

  const nodes: Node[] = [];
  const links: SankeyLink[] = [];
  if (revenue > 0) {
    nodes.push(
      node('src-agency', '政府関係機関の収入', revenue, {
        nodeType: 'source',
        accountKind: 'agency',
        breakdown: data.agencies.revenue.byCategory,
        description: '国が全額出資する法人の収入。予算は国会の議決対象',
      })
    );
    links.push({ source: 'src-agency', target: ACCOUNT_IDS.agency, value: revenue });
  }

  // 支出が収入を上回る分は借入等で賄われる。差額を隠すと図のフローが閉じないので明示する
  const shortfall = expenditure - revenue;
  if (shortfall > 0) {
    nodes.push(
      node('src-agency-shortfall', '政府関係機関の収入不足', shortfall, {
        nodeType: 'source',
        accountKind: 'agency',
        description: '支出が収入を上回る分。借入金等で賄われる',
      })
    );
    links.push({
      source: 'src-agency-shortfall',
      target: ACCOUNT_IDS.agency,
      value: shortfall,
    });
  }

  return { nodes, links };
}

/**
 * 会計から使途への流れ。
 *
 * 一般会計の繰入は特別会計ノードへ流し、二重計上の発生点を図で示す。
 * 特別会計の中で完結する再繰入は、宛先が特別会計自身になり閉路になるため
 * 独立したノード（控除対象）として置く。
 */
function accountFlows(data: MOFBudgetOverview): { nodes: Node[]; links: SankeyLink[] } {
  const nodes: Node[] = [];
  const links: SankeyLink[] = [];

  const g = data.generalAccount;
  const s = data.specialAccounts;
  const a = data.agencies;

  nodes.push(
    node(ACCOUNT_IDS.general, '一般会計', g.revenue.total, {
      nodeType: 'account',
      accountKind: 'general',
      breakdown: g.expenditure.byPurpose,
      description: '基本的な行政サービスの会計。予算単一の原則における原則側',
    }),
    node(ACCOUNT_IDS.special, '特別会計', s.revenue.total, {
      nodeType: 'account',
      accountKind: 'special',
      breakdown: s.revenue.byCategory,
      description:
        '特定の歳入を特定の歳出に充てるため区分経理する会計。財政法13条2項に基づく例外',
    })
  );
  if (a.expenditure.total > 0) {
    nodes.push(
      node(ACCOUNT_IDS.agency, '政府関係機関', a.expenditure.total, {
        nodeType: 'account',
        accountKind: 'agency',
        breakdown: a.expenditure.byAgency,
        description: '国が全額出資する法人。予算が国会の議決を要する',
      })
    );
  }

  // 一般会計 → 特別会計（繰入）。これが二重計上の主因
  if (g.expenditure.transferOut > 0) {
    links.push({
      source: ACCOUNT_IDS.general,
      target: ACCOUNT_IDS.special,
      value: g.expenditure.transferOut,
    });
  }

  // 特別会計の受入のうち、一般会計からの繰入で説明できない分。
  // 出し手も特別会計なので閉路になり、リンクにできない。再掲の財源ノードとして置く。
  const fromOtherSpecial =
    data.transfers.receivedBySpecial - g.expenditure.transferOut;
  if (fromOtherSpecial > 0) {
    nodes.push(
      node('src-special-reentry', '特別会計間の繰入（再掲）', fromOtherSpecial, {
        nodeType: 'transfer',
        accountKind: 'special',
        isDeduction: true,
        description:
          '特別会計が他の特別会計から受け入れた分。出し手も特別会計のため図では再掲として扱う',
      })
    );
    links.push({
      source: 'src-special-reentry',
      target: ACCOUNT_IDS.special,
      value: fromOtherSpecial,
    });
  }

  // 勘定間の受入も同じ理由で再掲にする
  if (data.transfers.receivedBetweenSubAccounts > 0) {
    nodes.push(
      node(
        'src-subaccount-reentry',
        '勘定間の繰入（再掲）',
        data.transfers.receivedBetweenSubAccounts,
        {
          nodeType: 'transfer',
          accountKind: 'special',
          isDeduction: true,
          description: '同じ特別会計の中で勘定から勘定へ回る分',
        }
      )
    );
    links.push({
      source: 'src-subaccount-reentry',
      target: ACCOUNT_IDS.special,
      value: data.transfers.receivedBetweenSubAccounts,
    });
  }

  // 一般会計の実支出
  nodes.push(
    node('net-general', '一般会計の実支出', g.expenditure.net, {
      nodeType: 'net-expenditure',
      accountKind: 'general',
      breakdown: g.expenditure.byPurpose.filter(p => p.name !== '他会計へ繰入'),
      description: '他会計への繰入を除いた、一般会計が実際に使う額',
    })
  );
  links.push({
    source: ACCOUNT_IDS.general,
    target: 'net-general',
    value: g.expenditure.net,
  });

  // 一般会計の歳入超過（歳入と歳出の差。通常はほぼ 0）
  const generalSurplus = g.revenue.total - g.expenditure.total;
  if (generalSurplus > 0) {
    nodes.push(
      node('surplus-general', '一般会計の歳入超過', generalSurplus, {
        nodeType: 'surplus',
        accountKind: 'general',
        description: '歳入が歳出を上回る差額',
      })
    );
    links.push({
      source: ACCOUNT_IDS.general,
      target: 'surplus-general',
      value: generalSurplus,
    });
  }

  // 特別会計の中で完結する再繰入（国債整理基金への繰入など）
  if (s.expenditure.transferOut > 0) {
    nodes.push(
      node('transfer-special', '特別会計間の再繰入', s.expenditure.transferOut, {
        nodeType: 'transfer',
        accountKind: 'special',
        isDeduction: true,
        breakdown: s.expenditure.transfersByDestination,
        description:
          '特別会計から他の会計・勘定へ回す分。国債整理基金への繰入が大半を占める。純計では控除する',
      })
    );
    links.push({
      source: ACCOUNT_IDS.special,
      target: 'transfer-special',
      value: s.expenditure.transferOut,
    });
  }

  // 特別会計の実支出
  nodes.push(
    node('net-special', '特別会計の実支出', s.expenditure.net, {
      nodeType: 'net-expenditure',
      accountKind: 'special',
      breakdown: s.expenditure.byPurpose.filter(p => p.name !== '他会計へ繰入'),
      description: '他会計への繰入を除いた、特別会計が実際に使う額',
    })
  );
  links.push({
    source: ACCOUNT_IDS.special,
    target: 'net-special',
    value: s.expenditure.net,
  });

  const specialSurplus = s.revenue.total - s.expenditure.total;
  if (specialSurplus > 0) {
    nodes.push(
      node('surplus-special', '特別会計の歳入超過', specialSurplus, {
        nodeType: 'surplus',
        accountKind: 'special',
        description: '歳入が歳出を上回る差額。積立等に回る',
      })
    );
    links.push({
      source: ACCOUNT_IDS.special,
      target: 'surplus-special',
      value: specialSurplus,
    });
  }

  if (a.expenditure.total > 0) {
    nodes.push(
      node('net-agency', '政府関係機関の支出', a.expenditure.total, {
        nodeType: 'net-expenditure',
        accountKind: 'agency',
        breakdown: a.expenditure.byAgency,
        description: '政府関係機関の支出',
      })
    );
    links.push({
      source: ACCOUNT_IDS.agency,
      target: 'net-agency',
      value: a.expenditure.total,
    });
  }

  return { nodes, links };
}

/** 集計 JSON からサンキーデータを組み立てる */
export function generateMOFBudgetOverviewSankey(
  data: MOFBudgetOverview
): MOFBudgetOverviewData {
  const parts = [
    generalSources(data),
    specialSources(data),
    agencySources(data),
    accountFlows(data),
  ];
  const nodes = parts.flatMap(p => p.nodes);
  const links = parts.flatMap(p => p.links).filter(l => l.value > 0);

  return {
    metadata: {
      ...data.metadata,
      grossTotal: data.totals.gross,
      netTotal: data.totals.net,
    },
    sankey: { nodes, links },
    summary: {
      generalAccount: {
        revenue: data.generalAccount.revenue.total,
        expenditure: data.generalAccount.expenditure.total,
        transferOut: data.generalAccount.expenditure.transferOut,
        net: data.generalAccount.expenditure.net,
      },
      specialAccounts: {
        revenue: data.specialAccounts.revenue.total,
        expenditure: data.specialAccounts.expenditure.total,
        transferOut: data.specialAccounts.expenditure.transferOut,
        net: data.specialAccounts.expenditure.net,
      },
      agencies: { expenditure: data.agencies.expenditure.total },
      transfers: data.transfers,
      totals: data.totals,
      accounts: data.specialAccounts.accounts,
    },
  };
}
