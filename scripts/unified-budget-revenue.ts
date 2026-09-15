/** 同年度・同基準の歳入CSVを統合グラフの会計IDへ集計する。 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { amountColumn, readBudgetTables, yen, zipPath, type CsvRow } from './mof-budget-csv';
import type { UnifiedBasis, UnifiedEdge, UnifiedGraphMetadata, UnifiedNode } from '../types/unified-budget';

const VALUE = '接続歳入額(円)';
const sectionKey = (r: CsvRow) => JSON.stringify([r['主管'] || r['所管'], r['特別会計'], r['勘定'], r['部コード'], r['款コード'], r['項コード']]);

/** 補正書に載る項だけを差し替える。変更なしの項見出し（目00）は明細を保持する。 */
export function mergeRevenueRevision(base: CsvRow[], revision: CsvRow[]): CsvRow[] {
  const previous = amountColumn(revision);
  const revised = Object.keys(revision[0] ?? {}).find(k => /^改(令和|平成)/.test(k));
  if (!revised) throw new Error('補正後歳入額の列がありません');
  const groups = new Map<string, CsvRow[]>();
  for (const row of base) { const k = sectionKey(row); groups.set(k, [...(groups.get(k) ?? []), row]); }
  const updates = new Map<string, CsvRow[]>();
  for (const row of revision) { const k = sectionKey(row); updates.set(k, [...(updates.get(k) ?? []), row]); }
  for (const [k, rows] of updates) {
    const existing = groups.get(k) ?? [];
    const priorTotal = rows.reduce((s, r) => s + yen(r, previous), 0);
    if (existing.reduce((s, r) => s + Number(r[VALUE]), 0) !== priorTotal) throw new Error(`補正前の歳入額が一致しません: ${k}`);
    if (rows.every(r => r['目コード'] === '00' && yen(r, revised) === yen(r, previous))) continue;
    groups.set(k, rows.map(r => ({ ...r, [VALUE]: String(yen(r, revised)) })));
  }
  return [...groups.values()].flat();
}

export function aggregateRevenueRows(rows: CsvRow[], accountType: 'general' | 'special', sourceUrl: string): { nodes: UnifiedNode[]; edges: UnifiedEdge[] } {
  const column = rows[0]?.[VALUE] !== undefined ? VALUE : rows[0]?.['収納済歳入額(円)'] !== undefined ? '収納済歳入額(円)' : amountColumn(rows);
  const nodes = new Map<string, UnifiedNode>();
  const targets = new Map<string, string>();
  for (const row of rows) {
    const amount = column.endsWith('(円)') ? Number(row[column]) : yen(row, column);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`歳入額が不正: ${row['目名']} = ${amount}`);
    if (amount === 0) continue;
    const category = row['款名'];
    const item = row['目名'] || row['項名'] || '';
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

export function readUnifiedRevenue(year: number, basis: UnifiedBasis = 'initial') {
  if (!['initial', 'supplementary', 'settlement'].includes(basis)) throw new Error(`歳入の対象外の基準: ${basis}`);
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const sources: NonNullable<UnifiedGraphMetadata['revenueSources']> = [];
  const read = (suffix: string) => {
    const file = zipPath(year, suffix);
    const url = `https://www.bb.mof.go.jp/server/${year}/csv/DL${year}${suffix}.zip`;
    if (!fs.existsSync(file)) throw new Error(`歳入CSVが必要です: ${url} → ${file}`);
    sources.push({ url, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      retrievedOn: fs.statSync(file).mtime.toISOString().slice(0, 10) });
    return { rows: readBudgetTables(year, suffix).revenue, url };
  };
  for (const accountType of ['general', 'special'] as const) {
    const special = accountType === 'special';
    let { rows, url } = read(basis === 'settlement' ? (special ? '78001' : '77001') : (special ? '12001' : '11001'));
    if (basis === 'supplementary') {
      const column = amountColumn(rows);
      rows = rows.map(r => ({ ...r, [VALUE]: String(yen(r, column)) }));
      // 対応年度の公表済み補正は第1号。2026年度は一般会計のみで特別会計の補正はない。
      if (!(year === 2026 && special)) {
        const revision = read(special ? '22001' : '21001');
        rows = mergeRevenueRevision(rows, revision.rows);
        url = revision.url;
      }
    }
    const result = aggregateRevenueRows(rows, accountType, url);
    nodes.push(...result.nodes.map(n => ({ ...n, revenueBasis: basis })));
    edges.push(...result.edges);
  }
  return { nodes, edges, sources };
}
