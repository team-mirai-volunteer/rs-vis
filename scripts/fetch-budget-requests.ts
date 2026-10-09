/** Unattended official-source ingestion. No API keys, LLM calls, or approval queues. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import type { BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord } from '../types/budget-requests';
import { discoverCatalogues, discoverChildren, discoverMinistries, officialUrl, sha256, sourceDocument } from './budget-requests-discover';


const MAX_BYTES = 40 * 1024 * 1024;
export interface SourceResponse { bytes: Uint8Array; contentType: string; url: string; retrievedAt?: string; }
export type SourceFetcher = (url: string) => Promise<SourceResponse>;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Validate each redirect independently; government links must not become arbitrary network requests. */
export async function fetchOfficialSource(initial: string): Promise<SourceResponse> {
  let url = officialUrl(initial);
  if (!url) throw new Error('公式政府ドメイン以外のURLは取得しません');
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'rs-vis-budget-requests/1.0 (+https://github.com/team-mirai-volunteer/rs-vis)', Accept: 'text/html,application/pdf,text/csv,application/xml,*/*;q=0.5' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = officialUrl(response.headers.get('location') ?? '', url);
      await response.body?.cancel();
      if (!next) throw new Error('政府ドメイン外へのリダイレクトを拒否しました');
      url = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('40 MBを超える資料は未取得'); }
    const chunks: Uint8Array[] = []; let size = 0;
    if (!response.body) throw new Error('応答本文がありません');
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error('40 MBを超える資料は未取得');
      chunks.push(chunk);
    }
    if (!size) throw new Error('応答本文が空です');
    return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') ?? '', url };
  }
  throw new Error('リダイレクト回数が上限を超えました');
}
export function decodeSource(source: SourceResponse): string {
  const prefix = Buffer.from(source.bytes.subarray(0, 2000)).toString('ascii');
  const encoding = source.contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? prefix.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  try { return new TextDecoder(encoding).decode(source.bytes); } catch { return new TextDecoder().decode(source.bytes); }
}
export function withSuccessfulFetch(doc: BudgetRequestDocument, source: SourceResponse, now: string): BudgetRequestDocument {
  const hash = sha256(source.bytes);
  const changed = doc.hash !== hash;
  const revision = changed ? doc.revision + 1 : doc.revision;
  return { ...doc, status: 'fetched', hash, revision, retrievedAt: source.retrievedAt ?? now, lastAttemptAt: source.retrievedAt ?? now, error: null, contentType: source.contentType,
    revisions: changed ? [...doc.revisions, { hash, retrievedAt: source.retrievedAt ?? now, revision }] : doc.revisions,
    validation: [ ...(changed && doc.hash ? ['同一URLの内容変更を検出し、再抽出しました'] : []), ...(source.url !== doc.url ? [`取得先リダイレクト: ${source.url}`] : []) ] };
}
export async function acquireDocument(doc: BudgetRequestDocument, fetcher: SourceFetcher, now: string, retries = 1): Promise<{ doc: BudgetRequestDocument; source: SourceResponse | null }> {
  let error: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { const source = await fetcher(doc.url); return { doc: withSuccessfulFetch(doc, source, now), source }; }
    catch (cause) { error = cause; if (attempt < retries && !/HTTP 40[134]|政府ドメイン|40 MB/.test(String(cause))) await delay(500 * 2 ** attempt); else break; }
  }
  return { doc: { ...doc, status: 'fetch_failed', lastAttemptAt: now, error: error instanceof Error ? error.message : String(error), validation: [...doc.validation.filter(v => !v.startsWith('最終成功')), ...(doc.hash ? ['最終成功時の抽出結果を保持。今回の取得は失敗しています'] : [])] }, source: null };
}
export interface IngestionOptions { year: number; maxFiles: number; maxPages: number; depth: number; concurrency: number; cacheDir: string; output: string; now?: string; fetcher?: SourceFetcher; previous?: BudgetRequestDataset; resume?: boolean; }
export async function ingestBudgetRequests(options: IngestionOptions): Promise<BudgetRequestDataset> {
  const { year, maxFiles, maxPages, depth, concurrency, cacheDir, output } = options;
  const now = options.now ?? new Date().toISOString();
  // Only the national annual index follows MOF's explicit stable pattern. Ministry URLs are discovered.
  const indexUrl = `https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy${year}/index.html`;
  const previous = options.previous?.requestedFY === year ? options.previous : undefined;
  const previousDocs = new Map(previous?.documents.map(d => [d.id, d]) ?? []);
  const documents = new Map<string, BudgetRequestDocument>();
  const records = new Map<string, BudgetRequestRecord[]>();
  const warnings = ['概算要求段階の資料です。成立予算・執行額ではありません。', '概要・要求書・要望・投資枠や親子項目は重複します。横断合計は行いません。', '標準明細表と対応するCSV/TSV/XMLを抽出します。概要図・画像PDF（OCR）・Excel・ZIP内包表・自由形式の要望/投資枠一覧は数値未対応です。', `公開リンクを最大${depth}階層まで探索。掲載漏れ・未対応形式・画像PDF・未取得資料があり、全件抽出を保証しません。`];
  const networkFetcher = options.fetcher ?? fetchOfficialSource;
  const cached = new Map(previous?.documents.filter(d => d.hash && d.retrievedAt && d.status !== 'fetch_failed').map(d => [d.url, d]) ?? []);
  const fetcher: SourceFetcher = async url => {
    const doc = cached.get(url);
    if (options.resume && doc?.hash && doc.retrievedAt && now.slice(0, 10) === doc.retrievedAt.slice(0, 10)) {
      try { const bytes = await readFile(join(cacheDir, doc.hash)); if (sha256(bytes) === doc.hash) return { bytes, contentType: doc.contentType ?? '', url, retrievedAt: doc.retrievedAt }; } catch { /* Re-fetch missing or corrupt cache. */ }
    }
    return networkFetcher(url);
  };
  await mkdir(cacheDir, { recursive: true });
  let pageCount = 0; let fileCount = 0;
  function register(doc: BudgetRequestDocument): BudgetRequestDocument {
    const existing = documents.get(doc.id);
    if (existing) return existing;
    const old = previousDocs.get(doc.id);
    const merged = old ? { ...old, title: doc.title, account: doc.account, ministry: doc.ministry, requestedFY: doc.requestedFY, documentType: doc.documentType, parentUrl: doc.parentUrl, lastAttemptAt: old.lastAttemptAt } : doc;
    documents.set(doc.id, merged);
    if (old) records.set(doc.id, previous!.records.filter(r => r.documentId === doc.id));
    return merged;
  }
  async function acquire(doc: BudgetRequestDocument) {
    const result = await acquireDocument(doc, fetcher, options.now ?? new Date().toISOString());
    documents.set(doc.id, result.doc);
    if (result.source && result.doc.hash) await writeFile(join(cacheDir, result.doc.hash), result.source.bytes);
    return result;
  }
  function snapshot(): BudgetRequestDataset {
    const docs = [...documents.values()];
    const items = [...records.values()].flat();
    return { schemaVersion: 1, requestedFY: year, generatedAt: options.now ?? new Date().toISOString(), indexUrl, coverage: { ministries: new Set(docs.filter(d => d.ministry !== '全府省').map(d => d.ministry)).size, discoveredDocuments: docs.length, fetchedDocuments: docs.filter(d => d.retrievedAt).length, extractedDocuments: docs.filter(d => d.recordCount > 0).length, records: items.length, warnings: [...warnings] }, documents: docs.sort((a, b) => a.ministry.localeCompare(b.ministry, 'ja') || a.url.localeCompare(b.url)), records: items };
  }
  async function save() {
    const dataset = snapshot();
    await mkdir(join(output, '..'), { recursive: true });
    await writeFile(`${output}.tmp`, gzipSync(JSON.stringify(dataset), { level: 9 }));
    await rename(`${output}.tmp`, output);
    return dataset;
  }
  const indexDoc = register(sourceDocument(indexUrl, `${year}年度 財務省公式索引`, '全府省', year, now, null, null, 'index'));
  const index = await acquire(indexDoc);
  if (!index.source) {
    warnings.push('財務省の年度索引を取得できませんでした。前回データがある場合はそのまま保持しています。');
    for (const doc of previous?.documents ?? []) if (!documents.has(doc.id)) { register(doc); documents.get(doc.id)!.validation.push('今回、全国索引の再取得に失敗。掲載継続は未確認'); }
    return save();
  }
  const catalogues = discoverCatalogues(decodeSource(index.source), indexUrl).sort((a, b) => Number(a.text === '特別会計') - Number(b.text === '特別会計'));
  if (catalogues.length < 3) warnings.push(`全国索引から確認できた分類は${catalogues.length}/3件。未確認の分類があります。`);
  const roots: BudgetRequestDocument[] = [];
  for (const catalogue of catalogues) {
    const doc = register(sourceDocument(catalogue.url, catalogue.text, '全府省', year, now, indexUrl, null, 'index'));
    const result = await acquire(doc);
    if (result.source) roots.push(...discoverMinistries(decodeSource(result.source), catalogue, year, now, roots).map(register));
    else warnings.push(`${catalogue.text}の全国リンク表を取得できませんでした。`);
  }
  // De-duplicate pages by ministry/URL even if linked from several national catalogues.
  const queue = [...new Map(roots.map(doc => [doc.id, { doc, level: 0 }])).values()];
  const visited = new Set<string>();
  const files = new Map<string, BudgetRequestDocument>();
  while (queue.length) {
    if (!options.resume) queue.sort((a, b) => Number(!!previousDocs.get(a.doc.id)?.retrievedAt) - Number(!!previousDocs.get(b.doc.id)?.retrievedAt));
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(async ({ doc: queued, level }) => {
      const doc = documents.get(queued.id)!;
      if (visited.has(doc.id)) return;
      visited.add(doc.id);
      if (/\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i.test(doc.url)) { files.set(doc.id, doc); return; }
      if (pageCount >= maxPages) { doc.validation.push('HTML取得件数上限のため今回未取得'); return; }
      pageCount++;
      const result = await acquire(doc);
      if (!result.source) return;
      const isHtml = /text\/html|application\/xhtml/.test(result.source.contentType) || /^\s*<!doctype html|^\s*<html/i.test(decodeSource(result.source).slice(0, 200));
      if (!isHtml) { files.set(doc.id, result.doc); return; }
      records.delete(doc.id);
      result.doc.recordCount = 0;
      result.doc.documentType = 'index';
      const children = discoverChildren(decodeSource(result.source), { ...result.doc, documentType: queued.documentType }, now).map(register);
      if (!children.length) result.doc.validation.push('対応する概算要求資料リンクを自動検出できませんでした');
      for (const child of children) {
        if (child.status === 'unsupported' && child.validation.some(v => v.includes('歳入'))) continue;
        if (/\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i.test(child.url)) files.set(child.id, child);
        else if (level < depth) queue.push({ doc: child, level: level + 1 });
        else child.validation.push('探索深度上限のため今回未取得');
      }
    }));
    await save();
    console.log(`Discovery: ${pageCount} pages, ${documents.size} sources, ${files.size} files`);
  }
  // Structured formats first. Within a format, interleave ministries so bounded runs remain representative.
  const grouped = new Map<string, BudgetRequestDocument[]>();
  for (const doc of files.values()) { const group = grouped.get(doc.ministry) ?? []; group.push(doc); grouped.set(doc.ministry, group); }
  const ordered: BudgetRequestDocument[] = [];
  for (let i = 0; ; i++) { const round = [...grouped.values()].flatMap(group => group[i] ? [group[i]] : []); if (!round.length) break; ordered.push(...round); }
  const priority = (doc: BudgetRequestDocument) => (!options.resume && previousDocs.get(doc.id)?.retrievedAt ? 10 : 0) + (/\.(csv|tsv|xml|xlsx?)(?:\?|$)/i.test(doc.url) ? 0 : doc.documentType === 'accounting_table' ? 1 : 2);
  ordered.sort((a, b) => priority(a) - priority(b));
  for (let offset = 0; offset < ordered.length; offset += concurrency) {
    if (fileCount >= maxFiles) {
      for (const remaining of ordered.slice(offset)) documents.get(remaining.id)!.validation.push('資料取得件数上限のため今回未取得');
      break;
    }
    await Promise.all(ordered.slice(offset, offset + concurrency).map(async original => {
      const doc = documents.get(original.id)!;
      if (fileCount >= maxFiles) { doc.validation.push('資料取得件数上限のため今回未取得'); return; }
      fileCount++;
      const result = await acquire(doc);
      if (!result.source) return;
      try {
        const { extractRequestDocument } = await import('./budget-requests-extract');
        const extracted = await extractRequestDocument(result.source.bytes, result.doc);
        records.set(doc.id, extracted.records);
        const types = [...new Set(extracted.records.map(record => record.documentType))];
        if (types.length === 1) result.doc.documentType = types[0];
        Object.assign(result.doc, { status: extracted.status, recordCount: extracted.records.length, validation: [...result.doc.validation, ...extracted.validation] });
      } catch (error) {
        // A changed source can never retain records for an older hash as though they came from new bytes.
        records.delete(doc.id);
        Object.assign(result.doc, { status: 'extraction_failed', recordCount: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }));
    await save();
    console.log(`Extraction: ${Math.min(fileCount, ordered.length)}/${ordered.length} files, ${[...records.values()].flat().length} records`);
  }
  if (fileCount < files.size) warnings.push(`資料${files.size}件中${fileCount}件を今回取得対象にしました。未取得資料もカタログに表示します。`);
  // Keep vanished sources visible rather than silently dropping them; no stale amount is made current.
  for (const old of previous?.documents ?? []) if (!documents.has(old.id)) { register(old); documents.get(old.id)!.validation.push('今回のリンク探索では再発見できませんでした。前回の記録を保持'); }
  return save();
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: number) => { const i = args.indexOf(name); const value = i < 0 ? fallback : Number(args[i + 1]); if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}`); return value; };
  const year = option('--year', 2027);
  if (year < 2020 || year > 2100) throw new Error('Invalid fiscal year');
  const output = join(process.cwd(), 'public', 'data', `budget-requests-${year}.json.gz`);
  let previous: BudgetRequestDataset | undefined;
  try { previous = JSON.parse(gunzipSync(await readFile(output)).toString('utf8')); } catch { /* First acquisition. */ }
  const result = await ingestBudgetRequests({ year, maxFiles: option('--max-files', 2000), maxPages: option('--max-pages', 200), depth: option('--depth', 2), concurrency: Math.max(1, Math.min(option('--concurrency', 3), 6)), cacheDir: join(process.cwd(), 'data', 'budget-requests', 'sources'), output, previous, resume: args.includes('--resume') });
  console.log(JSON.stringify(result.coverage, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
