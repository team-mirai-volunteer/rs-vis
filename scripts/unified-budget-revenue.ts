/** 当初予算の歳入CSVを、統合グラフの会計IDへ直接集計する。金額は円。 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { amountColumn, readBudgetTables, yen, zipPath, type CsvRow } from './mof-budget-csv';
import type { UnifiedEdge, UnifiedGraphMetadata, UnifiedNode } from '../types/unified-budget';

export function aggregateRevenueRows(rows: CsvRow[], accountType: 'general' | 'special', sourceUrl: string): { nodes: UnifiedNode[]; edges: UnifiedEdge[] } {
  const column = amountColumn(rows);
  const nodes = new Map<string, UnifiedNode>();
  const targets = new Map<string, string>();
  for (const row of rows) {
    const amount = yen(row, column);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`歳入額が不正: ${row['目名']} = ${amount}`);
    if (amount === 0) continue;
    const category = row['款名'];
    const item = row['目名'] ?? '';
    const organization = accountType === 'special' ? row['特別会計'] : undefined;
    if (!category || (accountType === 'special' && !organization)) throw new Error('歳入の款・特別会計名がありません');
    const internal = category === '他会計より受入' || category === '他勘定より受入'
      || item.includes('一般会計より受入')
      || /特別会計(受入金|整理収入|等負担金)$/.test(item);
    const name = internal ? (category === '他勘定より受入' ? '他勘定からの受入' : '他会計からの受入')
      : category === '租税' ? item : category;
    const kind: UnifiedNode['revenueKind'] = internal ? 'internal-transfer' : category === '租税' ? 'tax'
      : category === '公債金' ? 'bond' : /保険(料)?収入/.test(category) ? 'insurance' : 'other';
    const target = accountType === 'general' ? 'acct-general' : `acct-sp-${organization}`;
    const id = `revenue-${target}|${kind}|${name}`;
    const existing = nodes.get(id);
    if (existing) {
      existing.value += amount;
      existing.revenueAmount = existing.value;
    } else {
      nodes.set(id, { id, col: 'revenue', name: organization ? `${name}（${organization}）` : name,
        value: amount, revenueAmount: amount, revenueKind: kind,
        revenueCategory: internal ? name : category, accountType, organization, sourceUrl });
      targets.set(id, target);
    }
  }
  return { nodes: [...nodes.values()], edges: [...nodes.values()].map(n => ({ source: n.id, target: targets.get(n.id)!, value: n.value })) };
}

export function readUnifiedRevenue(year: number) {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const sources: NonNullable<UnifiedGraphMetadata['revenueSources']> = [];
  for (const [suffix, accountType] of [['11001', 'general'], ['12001', 'special']] as const) {
    const file = zipPath(year, suffix);
    const url = `https://www.bb.mof.go.jp/server/${year}/csv/DL${year}${suffix}.zip`;
    if (!fs.existsSync(file)) throw new Error(`歳入CSVが必要です: ${url} → ${file}`);
    const result = aggregateRevenueRows(readBudgetTables(year, suffix).revenue, accountType, url);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
    sources.push({ url, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      retrievedOn: fs.statSync(file).mtime.toISOString().slice(0, 10) });
  }
  return { nodes, edges, sources };
}
