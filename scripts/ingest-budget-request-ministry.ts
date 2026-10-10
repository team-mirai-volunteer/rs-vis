/**
 * 1 府省だけ再クロールして既存の概算要求データにマージする保守ツール。
 *
 * 全件取得（fetch-budget-requests.ts）は索引から全府省をたどるが、特定の公開元が取得時に落ちていた
 * （404 や一時的な 403）だけのときに全件を回すのは重い。このツールは、データセットにあるその府省の
 * 根の掲載ページ（財務省の索引から発見済みの URL）から同じ規則（discoverChildren・extractRequestDocument）で
 * たどり直し、資料と行を差し替える。別の府省の資料には触れない。
 *
 * 使い方: npx tsx scripts/ingest-budget-request-ministry.ts 内閣官房 [--fy 2027] [--depth 3]
 * 実行後: npm run validate:budget-requests && npm run generate-budget-request-links
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import type { BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord } from '../types/budget-requests';
import { acquireDocument, decodeSource, fetchOfficialSource } from './fetch-budget-requests';
import { discoverChildren } from './budget-requests-discover';
import { extractRequestDocument } from './budget-requests-extract';

const FILE_URL = /\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i;

export async function ingestMinistry(data: BudgetRequestDataset, ministry: string, options: { depth: number; now: string; cacheDir: string; fetcher?: typeof fetchOfficialSource; log?: (line: string) => void }): Promise<BudgetRequestDataset> {
  const { depth, now, cacheDir } = options;
  const fetcher = options.fetcher ?? fetchOfficialSource;
  const log = options.log ?? (() => {});
  const next: BudgetRequestDataset = structuredClone(data);
  const documents = new Map(next.documents.map(doc => [doc.id, doc]));
  const records = new Map<string, BudgetRequestRecord[]>();
  for (const record of next.records) records.set(record.documentId, [...(records.get(record.documentId) ?? []), record]);
  // 根 = 財務省の索引から直接発見された、この府省の掲載ページ
  const roots = next.documents.filter(doc => doc.ministry === ministry && doc.parentUrl && /www\.mof\.go\.jp/.test(doc.parentUrl));
  if (!roots.length) throw new Error(`${ministry} の掲載ページがデータセットにありません`);
  const visited = new Set<string>();
  const files: BudgetRequestDocument[] = [];
  const register = (doc: BudgetRequestDocument) => {
    const old = documents.get(doc.id);
    const merged = old ? { ...old, title: doc.title, account: doc.account, parentUrl: doc.parentUrl, documentType: old.hash ? old.documentType : doc.documentType } : doc;
    documents.set(doc.id, merged);
    return merged;
  };
  const queue = roots.map(doc => ({ doc, level: 0 }));
  while (queue.length) {
    const { doc: queued, level } = queue.shift()!;
    const doc = documents.get(queued.id) ?? register(queued);
    if (visited.has(doc.id)) continue;
    visited.add(doc.id);
    if (FILE_URL.test(doc.url)) { files.push(doc); continue; }
    const result = await acquireDocument(doc, fetcher, now);
    documents.set(doc.id, result.doc);
    log(`page ${result.doc.status} ${doc.url}`);
    if (!result.source) continue;
    if (result.doc.hash) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(path.join(cacheDir, result.doc.hash), result.source.bytes); }
    const isHtml = /text\/html|application\/xhtml/.test(result.source.contentType) || /^\s*<!doctype html|^\s*<html/i.test(decodeSource(result.source).slice(0, 200));
    if (!isHtml) { files.push(result.doc); continue; }
    result.doc.documentType = 'index';
    result.doc.recordCount = 0;
    records.delete(doc.id);
    const children = discoverChildren(decodeSource(result.source), { ...result.doc, documentType: queued.documentType }, now).map(register);
    if (!children.length) result.doc.validation = [...new Set([...result.doc.validation, '対応する概算要求資料リンクを自動検出できませんでした'])];
    for (const child of children) {
      if (child.status === 'unsupported' && child.validation.some(value => value.includes('歳入'))) continue;
      if (FILE_URL.test(child.url)) files.push(child);
      else if (level < depth) queue.push({ doc: child, level: level + 1 });
    }
  }
  for (const original of files) {
    const doc = documents.get(original.id)!;
    const result = await acquireDocument(doc, fetcher, now);
    documents.set(doc.id, result.doc);
    if (!result.source) { log(`file ${result.doc.status} ${doc.url}`); continue; }
    if (result.doc.hash) writeFileSync(path.join(cacheDir, result.doc.hash), result.source.bytes);
    try {
      const extracted = await extractRequestDocument(result.source.bytes, result.doc);
      records.set(doc.id, extracted.records);
      const types = [...new Set(extracted.records.map(record => record.documentType))];
      if (types.length === 1) result.doc.documentType = types[0];
      Object.assign(result.doc, { status: extracted.status, recordCount: extracted.records.length,
        validation: [...new Set([...result.doc.validation.filter(note => /^(?:同一URL|取得先リダイレクト)/.test(note)), ...extracted.validation])] });
    } catch (error) {
      records.delete(doc.id);
      Object.assign(result.doc, { status: 'extraction_failed', recordCount: 0, error: error instanceof Error ? error.message : String(error) });
    }
    log(`file ${result.doc.status} ${result.doc.recordCount} rows ${doc.url}`);
  }
  const docs = [...documents.values()].sort((a, b) => a.ministry.localeCompare(b.ministry, 'ja') || a.url.localeCompare(b.url));
  next.documents = docs;
  next.records = docs.flatMap(doc => records.get(doc.id) ?? []);
  next.generatedAt = now;
  next.coverage = { ...next.coverage, ministries: new Set(docs.filter(doc => doc.ministry !== '全府省').map(doc => doc.ministry)).size, discoveredDocuments: docs.length,
    fetchedDocuments: docs.filter(doc => doc.retrievedAt).length, extractedDocuments: docs.filter(doc => doc.recordCount > 0).length, records: next.records.length };
  return next;
}

async function main() {
  const args = process.argv.slice(2);
  const ministry = args.find(arg => !arg.startsWith('--'));
  if (!ministry) throw new Error('使い方: ingest-budget-request-ministry.ts <府省名> [--fy 2027] [--depth 3]');
  const option = (name: string, fallback: number) => { const i = args.indexOf(name); return i < 0 ? fallback : Number(args[i + 1]); };
  const fy = option('--fy', 2027);
  const base = path.join(process.cwd(), 'public', 'data', `budget-requests-${fy}.json`);
  const data: BudgetRequestDataset = existsSync(base) ? JSON.parse(readFileSync(base, 'utf8')) : JSON.parse(gunzipSync(readFileSync(`${base}.gz`)).toString('utf8'));
  const before = { documents: data.documents.filter(doc => doc.ministry === ministry).length, records: data.records.filter(record => record.ministry === ministry).length };
  const result = await ingestMinistry(data, ministry, { depth: option('--depth', 3), now: new Date().toISOString(), cacheDir: path.join(process.cwd(), 'data', 'budget-requests', 'sources'), log: line => console.log(line) });
  const json = JSON.stringify(result);
  writeFileSync(base, json);
  writeFileSync(`${base}.gz`, gzipSync(json, { level: 9 }));
  const after = { documents: result.documents.filter(doc => doc.ministry === ministry).length, records: result.records.filter(record => record.ministry === ministry).length };
  console.log(JSON.stringify({ ministry, before, after, coverage: result.coverage }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });

