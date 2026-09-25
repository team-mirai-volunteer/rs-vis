/** Build an isolated provisional graph. Does not modify official CSV/graph outputs. */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { apiDetail, executionGraph, knownAmount } from './rs-api-adapter';
import type { RsApiCoverage, RsApiDetail, RsApiGroup, RsApiEdge, RsApiProject } from '../types/rs-api';
import { UNIFIED_COLUMNS, type UnifiedGraph } from '../types/unified-budget';

const sheetYear = Number(process.argv[2] || 2026);
if (sheetYear !== 2026) throw Error('Only provisional sheet 2026 is enabled');
const root = path.resolve(`data/rs-api/${sheetYear}`);
const projects: RsApiProject[] = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
type Envelope<T> = { fetchedAt: string; url: string; sha256: string; data: T };
const provenance: Omit<Envelope<unknown>, 'data'>[] = [];
function read<T>(file: string): Envelope<T> | undefined {
  if (!fs.existsSync(file)) return;
  const env: Envelope<T> = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!env.fetchedAt || !env.sha256 || !env.url) throw Error(`Invalid provenance: ${file}`);
  provenance.push({ fetchedAt: env.fetchedAt, sha256: env.sha256, url: env.url });
  return env;
}
for (const file of fs.readdirSync(root).filter(f => /^list-\d+\.json$/.test(f))) read(path.join(root, file));
const details: Record<string, RsApiDetail> = {};
for (const p of projects) {
  if (p.fiscal_year !== sheetYear || !/^\d+$/.test(p.project_number)) throw Error(`Invalid project ${p.id}`);
  const pid = Number(p.project_number);
  if (details[pid]) throw Error(`Duplicate project number ${pid}`);
  const groups = read<RsApiGroup[]>(path.join(root, p.id, 'payment-groups.json'));
  const edges = read<RsApiEdge[]>(path.join(root, p.id, 'payment-edges.json'));
  if (groups && (!Array.isArray(groups.data) || groups.data.some(g => g.project_id !== p.id))) throw Error(`Wrong payment groups ${p.id}`);
  if (edges && !Array.isArray(edges.data)) throw Error(`Invalid payment edges ${p.id}`);
  const d = apiDetail(p, groups?.data, edges?.data, groups?.fetchedAt ?? null);
  // Retain only fields used by the provisional detail view (raw API envelopes stay under data/rs-api).
  d.groups = d.groups.map(g => ({ id: g.id, project_id: g.project_id, display_code: g.display_code, name: g.name,
    overview: g.overview, total_amount: knownAmount(g.total_amount, g.negative_total_amount_count),
    payments: g.payments.map(p => ({ id: p.id, name: p.name, corporate_number: p.corporate_number, is_others: p.is_others, type: p.type,
      total_contract_amount: knownAmount(p.total_contract_amount, p.negative_total_contract_amount_count),
      contracts: p.contracts.map(c => ({ overview: c.overview, amount: knownAmount(c.amount), amount_breakdown: c.amount_breakdown })) })) }));
  d.edges = d.edges.map(e => ({ source_node_id: e.source_node_id, target_node_id: e.target_node_id, is_connected_to_source_root: e.is_connected_to_source_root, label: e.label }));
  details[pid] = d;
}
const rows = Object.values(details);
const timestamps = provenance.map(p => p.fetchedAt).sort();
const coverage: RsApiCoverage = { source: 'rs-api', provisional: true, listed: rows.length,
  executionKnown: rows.filter(d => d.execution !== null).length,
  paymentsFetched: rows.filter(d => d.paymentStatus === 'available').length,
  paymentsMissing: rows.filter(d => d.paymentStatus === 'missing').length,
  executionUnknown: rows.filter(d => d.execution === null).length,
  unknownPaymentAmounts: rows.flatMap(d => d.groups).flatMap(g => g.payments).filter(p => p.total_contract_amount === null).length,
  fetchedFrom: timestamps[0], fetchedThrough: timestamps.at(-1)!,
};
const { nodes, edges } = executionGraph(rows);
const total = rows.reduce((s, d) => s + (d.execution ?? 0), 0);
const counts = Object.fromEntries(UNIFIED_COLUMNS.map(c => [c, nodes.filter(n => n.col === c).length])) as UnifiedGraph['metadata']['counts'];
counts.edges = edges.length;
counts.scaledEdges = 0;
const graph: UnifiedGraph = { nodes, edges, metadata: {
  apiCoverage: coverage, budgetYear: sheetYear - 1, rsSheetYear: sheetYear, basis: 'execution', basisLabel: '執行実績（暫定）',
  rsMeasureLabel: '執行額', hasSpending: true, rsAmountKind: 'budget', basisBudgetType: '決算', eraLabel: '令和7年度', unit: 'yen', generatedAt: new Date().toISOString(),
  totals: { gross: total, net: total, transfer: 0, rsLinked: 0, rsProgram: total, outside: 0, scaledDown: 0,
    byKind: { rs: total, transfer: 0, debt: 0, 'local-transfer': 0, reserve: 0, personnel: 0, unmatched: 0, outside: 0 }, agency: 0, overviewNet: null },
  counts, collapsedAccounts: [], notes: [
    'RS公開APIによる暫定取得。2026年度シートに載る2025年度執行実績。全政府の決算・純計ではない。',
    '事業列は執行額、事業(支出)列は確認できた直接支出先への金額合計。上位支出先の記載・丸め等により一致しない。',
    '未取得・非公表の金額を0円とみなさない。前年度の正の執行額を確認できない事業は想定支出先の可能性があるため支出先を接続しない。再委託は直接支出に合算しない。',
    '財務省の会計・項・目との突合および政策評価は未実施。公式CSV取得後に検証して置き換える。',
  ],
} };
function publish(name: string, value: unknown) {
  const file = path.resolve('public/data', name);
  const text = JSON.stringify(value);
  fs.writeFileSync(`${file}.tmp`, text);
  fs.writeFileSync(`${file}.gz.tmp`, gzipSync(text, { level: 9 }));
  fs.renameSync(`${file}.tmp`, file);
  fs.renameSync(`${file}.gz.tmp`, `${file}.gz`);
}
publish('unified-budget-2025-execution-graph.json', graph);
publish('rs-api-2026-details.json', details);
publish('rs-api-2026-provenance.json', { coverage, sources: provenance });
console.log(JSON.stringify({ coverage, counts, executionTotal: total }, null, 2));
