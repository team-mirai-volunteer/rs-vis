/** Unattended official-source ingestion. No API keys, LLM calls, or approval queues. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord } from '../types/budget-requests';
import { discoverCatalogues, discoverChildren, discoverMinistries, officialUrl, sha256, sourceDocument, isCurrentRequestSource } from './budget-requests-discover';


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
/** These notes describe a traversal attempt, not the source or extraction result. */
const RUN_NOTE = /^(?:HTML取得件数上限|資料取得件数上限|探索深度上限|今回、全国索引|今回のリンク探索|対応する概算要求資料リンクを自動検出)/;
const unique = (values: string[]) => [...new Set(values)];
const persistentNotes = (values: string[]) => unique(values.filter(value => !RUN_NOTE.test(value)));

/** Acquisition timestamps are operational; source hashes and extracted content are semantic. */
export function semanticSnapshot(data: BudgetRequestDataset): string {
  return JSON.stringify({ ...data, documents: [...data.documents].sort((a, b) => a.id.localeCompare(b.id)), records: [...data.records].sort((a, b) => a.id.localeCompare(b.id)) }, (key, value) => ['generatedAt', 'retrievedAt', 'lastAttemptAt'].includes(key) ? undefined : value);
}
export function preserveUnchangedSnapshot(next: BudgetRequestDataset, previous?: BudgetRequestDataset): BudgetRequestDataset {
  return previous && semanticSnapshot(next) === semanticSnapshot(previous) ? structuredClone(previous) : next;
}
export function withSuccessfulFetch(doc: BudgetRequestDocument, source: SourceResponse, now: string): BudgetRequestDocument {
  const hash = sha256(source.bytes);
  const changed = doc.hash !== hash;
  const revision = changed ? doc.revision + 1 : doc.revision;
  const acquiredAt = source.retrievedAt ?? now;
  // Keep provenance tied to the first acquisition of these exact bytes. Freshness is recorded separately.
  const retrievedAt = changed ? acquiredAt : doc.retrievedAt ?? acquiredAt;
  return { ...doc, status: 'fetched', hash, revision, retrievedAt,
    lastAttemptAt: changed || doc.status === 'fetch_failed' ? acquiredAt : doc.lastAttemptAt,
    error: null, contentType: source.contentType,
    revisions: changed ? [...doc.revisions.map(item => ({ ...item })), { hash, retrievedAt, revision }] : doc.revisions.map(item => ({ ...item })),
    validation: unique([...(changed ? (doc.hash ? ['同一URLの内容変更を検出し、再抽出しました'] : []) : persistentNotes(doc.validation).filter(note => !note.startsWith('最終成功'))),
      ...(source.url !== doc.url ? [`取得先リダイレクト: ${source.url}`] : [])]) };
}
export async function acquireDocument(doc: BudgetRequestDocument, fetcher: SourceFetcher, now: string, retries = 1): Promise<{ doc: BudgetRequestDocument; source: SourceResponse | null }> {
  let error: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (!isCurrentRequestSource(doc.url, doc.requestedFY)) throw new Error('政府ドメインまたは要求年度に一致しない取得元です');
      const source = await fetcher(doc.url);
      if (!isCurrentRequestSource(source.url, doc.requestedFY)) throw new Error('政府ドメインまたは要求年度に一致しないリダイレクト先です');
      return { doc: withSuccessfulFetch(doc, source, now), source };
    }
    catch (cause) { error = cause; if (attempt < retries && !/HTTP 40[134]|政府ドメイン|40 MB/.test(String(cause))) await delay(500 * 2 ** attempt); else break; }
  }
  return { doc: { ...doc, status: 'fetch_failed', lastAttemptAt: now, error: error instanceof Error ? error.message : String(error), validation: unique([...persistentNotes(doc.validation).filter(v => !v.startsWith('最終成功')), ...(doc.hash ? ['最終成功時の抽出結果を保持。今回の取得は失敗しています'] : [])]) }, source: null };
}
export interface IngestionOptions { year: number; maxFiles: number; maxPages: number; depth: number; concurrency: number; cacheDir: string; output: string; now?: string; fetcher?: SourceFetcher; previous?: BudgetRequestDataset; resume?: boolean; }
interface Checkpoint {
  version: 1; fingerprint: string; year: number; depth: number; startedAt: string; complete: boolean;
  completedPages: string[]; completedFiles: string[]; dataset: BudgetRequestDataset;
  sources: Record<string, { hash: string; contentType: string; url: string; retrievedAt: string }>;
}
async function atomicWrite(path: string, bytes: Uint8Array | string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}
export async function ingestionFingerprint(): Promise<string> {
  return sha256((await Promise.all(['fetch-budget-requests.ts', 'budget-requests-extract.ts', 'budget-requests-discover.ts'].map(file => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n'));
}
export async function ingestBudgetRequests(options: IngestionOptions): Promise<BudgetRequestDataset> {
  const { year, maxFiles, maxPages, depth, concurrency, cacheDir, output } = options;
  if (![year, maxFiles, maxPages, depth, concurrency].every(Number.isInteger) || maxFiles < 0 || maxPages < 0 || depth < 0 || concurrency < 1) throw new Error('Invalid ingestion limits');
  const now = options.now ?? new Date().toISOString(); // One timestamp for this entire invocation.
  const indexUrl = `https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy${year}/index.html`;
  await mkdir(cacheDir, { recursive: true });
  await mkdir(join(output, '..'), { recursive: true });
  const checkpointPath = join(cacheDir, `checkpoint-${year}.json.gz`);
  // Do not reuse extraction results after the parser/discovery/ingestion implementation changes.
  const fingerprint = await ingestionFingerprint();
  let checkpoint: Checkpoint | undefined;
  let cachedBaseline: BudgetRequestDataset | undefined;
  if (options.resume) {
    try {
      const saved = JSON.parse(gunzipSync(await readFile(checkpointPath)).toString('utf8')) as Checkpoint;
      if (saved.version === 1 && saved.fingerprint === fingerprint && saved.year === year && saved.depth === depth) {
        cachedBaseline = saved.dataset;
        if (!saved.complete) checkpoint = saved;
      }
    } catch { /* Missing/corrupt checkpoints start a fresh bounded cycle. */ }
  }
  const supplied = options.previous?.requestedFY === year ? options.previous : undefined;
  const baseline = checkpoint?.dataset ?? (cachedBaseline && (!supplied || cachedBaseline.generatedAt > supplied.generatedAt) ? cachedBaseline : supplied);
  let originalOutput: Buffer | undefined;
  let originalJson: string | undefined;
  try { originalOutput = await readFile(output); originalJson = gunzipSync(originalOutput).toString('utf8'); } catch { /* No readable output yet. */ }
  const previous = baseline ? structuredClone(baseline) : undefined;
  if (previous) {
    previous.documents = previous.documents.filter(doc => isCurrentRequestSource(doc.url, year));
    const allowed = new Set(previous.documents.map(doc => doc.id));
    previous.records = previous.records.filter(record => allowed.has(record.documentId));
  }
  const documents = new Map(previous?.documents.map(doc => [doc.id, { ...doc, validation: unique(doc.validation.filter(note => !RUN_NOTE.test(note) || /^今回のリンク探索|^今回、全国索引/.test(note))) }]) ?? []);
  const records = new Map<string, BudgetRequestRecord[]>();
  for (const record of previous?.records ?? []) { const group = records.get(record.documentId) ?? []; group.push(record); records.set(record.documentId, group); }
  const discovered = new Set<string>();
  const discoveryTypes = new Map<string, BudgetRequestDocument['documentType']>();
  const completedPages = new Set(checkpoint?.completedPages ?? []);
  const completedFiles = new Set(checkpoint?.completedFiles ?? []);
  const sources: Checkpoint['sources'] = checkpoint?.sources ?? {};
  const warnings = ['概算要求段階の資料です。成立予算・執行額ではありません。', '概要・要求書・要望・投資枠や親子項目は重複します。横断合計は行いません。', '標準明細表と対応するCSV/TSV/XMLを抽出します。概要図・画像PDF（OCR）・Excel・ZIP内包表・自由形式の要望/投資枠一覧は数値未対応です。', `公開リンクを最大${depth}階層まで探索。掲載漏れ・未対応形式・画像PDF・未取得資料があり、全件抽出を保証しません。`];
  const networkFetcher = options.fetcher ?? fetchOfficialSource;
  const attempts: { url: string; checkedAt: string; status: 'success' | 'failed'; hash?: string; error?: string }[] = [];
  const fetcher: SourceFetcher = async url => {
    try {
      const source = await networkFetcher(url);
      const retrievedAt = source.retrievedAt ?? now;
      sources[url] = { hash: sha256(source.bytes), contentType: source.contentType, url: source.url, retrievedAt };
      attempts.push({ url, checkedAt: now, status: 'success', hash: sources[url].hash });
      return { ...source, retrievedAt };
    } catch (error) {
      attempts.push({ url, checkedAt: now, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  let pageCount = 0; let fileCount = 0; let deferredPages = 0; let deferredFiles = 0;
  const deferredSources = new Map<string, { id: string; url: string; reason: string }>();
  function defer(doc: BudgetRequestDocument, reason: string) { deferredSources.set(doc.id, { id: doc.id, url: doc.url, reason }); }
  function register(doc: BudgetRequestDocument): BudgetRequestDocument {
    if (discovered.has(doc.id)) return documents.get(doc.id)!;
    discovered.add(doc.id);
    discoveryTypes.set(doc.id, doc.documentType);
    const old = documents.get(doc.id);
    const merged = old ? { ...old, title: doc.title, account: doc.account, ministry: doc.ministry, requestedFY: doc.requestedFY,
      documentType: old.hash ? old.documentType : doc.documentType, parentUrl: doc.parentUrl, validation: persistentNotes(old.validation), revisions: old.revisions.map(item => ({ ...item })) } : structuredClone(doc);
    documents.set(doc.id, merged);
    return merged;
  }
  async function cachedSource(doc: BudgetRequestDocument): Promise<SourceResponse | null> {
    const saved = sources[doc.url];
    if (!saved) return null;
    try {
      const bytes = await readFile(join(cacheDir, saved.hash));
      if (sha256(bytes) === saved.hash && isCurrentRequestSource(saved.url, year)) return { bytes, ...saved };
    } catch { /* Re-fetch missing or corrupt cache within this invocation's budget. */ }
    return null;
  }
  async function acquire(doc: BudgetRequestDocument) {
    const result = await acquireDocument(doc, fetcher, now);
    documents.set(doc.id, result.doc);
    if (result.source && result.doc.hash) await atomicWrite(join(cacheDir, result.doc.hash), result.source.bytes);
    return result;
  }
  async function acquirePage(doc: BudgetRequestDocument, bounded: boolean) {
    if (completedPages.has(doc.id)) {
      if (doc.status === 'fetch_failed') return { doc, source: null };
      const source = await cachedSource(doc);
      if (source) return { doc, source };
      completedPages.delete(doc.id);
    }
    if (bounded && pageCount >= maxPages) { defer(doc, 'HTML取得件数上限のため今回未取得'); deferredPages++; return { doc, source: null }; }
    if (bounded) pageCount++;
    const result = await acquire(doc);
    completedPages.add(doc.id); // Failed sources are retried next cycle, never starve later sources.
    return result;
  }
  function snapshot(): BudgetRequestDataset {
    const docs = [...documents.values()].map(doc => ({ ...doc, validation: unique(doc.validation) })).sort((a, b) => a.ministry.localeCompare(b.ministry, 'ja') || a.url.localeCompare(b.url));
    // Stable source order without scrambling row/page order inside each extracted document.
    const items = docs.flatMap(doc => records.get(doc.id) ?? []);
    const next: BudgetRequestDataset = { schemaVersion: 1, requestedFY: year, generatedAt: now, indexUrl,
      coverage: { ministries: new Set(docs.filter(doc => doc.ministry !== '全府省').map(doc => doc.ministry)).size, discoveredDocuments: docs.length,
        fetchedDocuments: docs.filter(doc => doc.retrievedAt).length, extractedDocuments: docs.filter(doc => doc.recordCount > 0).length, records: items.length, warnings: unique(warnings) }, documents: docs, records: items };
    return preserveUnchangedSnapshot(next, baseline);
  }
  async function save(complete = false) {
    const dataset = snapshot();
    const json = JSON.stringify(dataset);
    const bytes = originalOutput && originalJson === json ? originalOutput : gzipSync(json, { level: 9 });
    let unchanged = false;
    try {
      // Also preserve existing gzip metadata/compression when the serialized snapshot is unchanged.
      unchanged = (await readFile(output)).equals(bytes);
    } catch { /* First snapshot. */ }
    if (!unchanged) await atomicWrite(output, bytes);
    const state: Checkpoint = { version: 1, fingerprint, year, depth, startedAt: checkpoint?.startedAt ?? now, complete,
      completedPages: [...completedPages], completedFiles: [...completedFiles], dataset, sources };
    await atomicWrite(checkpointPath, gzipSync(JSON.stringify(state), { level: 9 }));
    await atomicWrite(join(cacheDir, `last-run-${year}.json`), JSON.stringify({ startedAt: now, cycleStartedAt: state.startedAt, complete,
      pagesAttempted: pageCount, filesAttempted: fileCount, deferredPages, deferredFiles, deferredSources: [...deferredSources.values()], attempts, snapshotGeneratedAt: dataset.generatedAt }, null, 2));
    return dataset;
  }
  const indexDoc = register(sourceDocument(indexUrl, `${year}年度 財務省公式索引`, '全府省', year, now, null, null, 'index'));
  const index = await acquirePage(indexDoc, false);
  if (!index.source) {
    warnings.push('財務省の年度索引を取得できませんでした。前回データがある場合はそのまま保持しています。');
    for (const doc of documents.values()) if (!discovered.has(doc.id)) doc.validation = unique([...doc.validation, '今回、全国索引の再取得に失敗。掲載継続は未確認']);
    return save(true);
  }
  for (const doc of documents.values()) doc.validation = doc.validation.filter(note => !note.startsWith('今回、全国索引'));
  const catalogues = discoverCatalogues(decodeSource(index.source), indexUrl).sort((a, b) => Number(a.text === '特別会計') - Number(b.text === '特別会計'));
  if (catalogues.length < 3) warnings.push(`全国索引から確認できた分類は${catalogues.length}/3件。未確認の分類があります。`);
  const roots: BudgetRequestDocument[] = [];
  for (const catalogue of catalogues) {
    const doc = register(sourceDocument(catalogue.url, catalogue.text, '全府省', year, now, indexUrl, null, 'index'));
    const result = await acquirePage(doc, false);
    if (result.source) roots.push(...discoverMinistries(decodeSource(result.source), catalogue, year, now, roots).map(register));
    else warnings.push(`${catalogue.text}の全国リンク表を取得できませんでした。`);
  }
  const queue = [...new Map(roots.map(doc => [doc.id, { doc, level: 0 }])).values()];
  const visited = new Set<string>();
  const files = new Map<string, BudgetRequestDocument>();
  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(async ({ doc: queued, level }) => {
      const doc = documents.get(queued.id)!;
      if (visited.has(doc.id)) return;
      visited.add(doc.id);
      if (/\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i.test(doc.url)) { files.set(doc.id, doc); return; }
      const discoveryType = discoveryTypes.get(doc.id) ?? queued.documentType;
      const result = await acquirePage(doc, true);
      if (!result.source) return;
      const isHtml = /text\/html|application\/xhtml/.test(result.source.contentType) || /^\s*<!doctype html|^\s*<html/i.test(decodeSource(result.source).slice(0, 200));
      if (!isHtml) { files.set(doc.id, result.doc); return; }
      records.delete(doc.id);
      result.doc.recordCount = 0;
      result.doc.documentType = 'index';
      const children = discoverChildren(decodeSource(result.source), { ...result.doc, documentType: discoveryType }, now).map(register);
      if (!children.length) result.doc.validation = unique([...result.doc.validation, '対応する概算要求資料リンクを自動検出できませんでした']);
      for (const child of children) {
        if (child.status === 'unsupported' && child.validation.some(value => value.includes('歳入'))) continue;
        if (/\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i.test(child.url)) files.set(child.id, child);
        else if (level < depth) queue.push({ doc: child, level: level + 1 });
        else defer(child, '探索深度上限のため今回未取得');
      }
    }));
    await save();
    console.log(`Discovery: ${pageCount} new pages, ${documents.size} sources, ${files.size} files`);
  }
  const grouped = new Map<string, BudgetRequestDocument[]>();
  for (const doc of files.values()) { const group = grouped.get(doc.ministry) ?? []; group.push(doc); grouped.set(doc.ministry, group); }
  const ordered: BudgetRequestDocument[] = [];
  for (let i = 0; ; i++) { const round = [...grouped.values()].flatMap(group => group[i] ? [group[i]] : []); if (!round.length) break; ordered.push(...round); }
  const priority = (doc: BudgetRequestDocument) => (/\.(csv|tsv|xml|xlsx?)(?:\?|$)/i.test(doc.url) ? 0 : doc.documentType === 'accounting_table' ? 1 : 2);
  ordered.sort((a, b) => priority(a) - priority(b));
  const pending = ordered.filter(doc => !completedFiles.has(doc.id));
  for (let offset = 0; offset < pending.length; offset += concurrency) {
    await Promise.all(pending.slice(offset, offset + concurrency).map(async original => {
      const doc = documents.get(original.id)!;
      if (fileCount >= maxFiles) { defer(doc, '資料取得件数上限のため今回未取得'); deferredFiles++; return; }
      fileCount++;
      // Extensionless files may already have been downloaded during page discovery.
      const cached = completedPages.has(doc.id) ? await cachedSource(doc) : null;
      const result = cached ? { doc, source: cached } : await acquire(doc);
      if (result.source) {
        try {
          result.doc.documentType = discoveryTypes.get(doc.id) ?? result.doc.documentType;
          const { extractRequestDocument } = await import('./budget-requests-extract');
          const extracted = await extractRequestDocument(result.source.bytes, result.doc);
          records.set(doc.id, extracted.records);
          const types = [...new Set(extracted.records.map(record => record.documentType))];
          if (types.length === 1) result.doc.documentType = types[0];
          // Replace old extraction diagnostics, retaining only revision/redirect provenance.
          Object.assign(result.doc, { status: extracted.status, recordCount: extracted.records.length,
            validation: unique([...result.doc.validation.filter(note => /^(?:同一URL|取得先リダイレクト)/.test(note)), ...extracted.validation]) });
        } catch (error) {
          records.delete(doc.id);
          Object.assign(result.doc, { status: 'extraction_failed', recordCount: 0, error: error instanceof Error ? error.message : String(error) });
        }
      }
      completedFiles.add(doc.id);
    }));
    await save();
    console.log(`Extraction: ${fileCount} new files, ${completedFiles.size} completed in this cycle`);
    if (fileCount >= maxFiles) {
      for (const remaining of pending.slice(offset + concurrency)) {
        const doc = documents.get(remaining.id)!;
        defer(doc, '資料取得件数上限のため今回未取得'); deferredFiles++;
      }
      break;
    }
  }
  // Budget/depth deferrals are operational, not source changes. Do not create commits or claim
  // that a source disappeared merely because this invocation has not traversed its parent yet.
  for (const doc of documents.values()) if (deferredPages === 0 && !discovered.has(doc.id)) doc.validation = unique([...doc.validation, '今回のリンク探索では再発見できませんでした。前回の記録を保持']);
  return save(deferredPages === 0 && deferredFiles === 0);
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
