/** Reproducible offline re-extraction from saved official bytes. Never makes HTTP calls. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import type { BudgetRequestDataset, BudgetRequestRecord } from '../types/budget-requests';
import { decodeSource } from './fetch-budget-requests';
import { discoverChildren, documentType, sha256 } from './budget-requests-discover';
import { extractRequestDocument } from './budget-requests-extract';
import { validateBudgetRequests } from './validate-budget-requests';

export async function reprocessBudgetRequests(data: BudgetRequestDataset, cacheDir: string): Promise<BudgetRequestDataset> {
  const next = structuredClone(data);
  const documents = new Map(next.documents.map(doc => [doc.id, doc]));
  const records = new Map<string, BudgetRequestRecord[]>(next.documents.map(doc => [doc.id, next.records.filter(record => record.documentId === doc.id)]));
  const bytes = new Map<string, Uint8Array>();
  for (const doc of next.documents) {
    if (!doc.hash) continue;
    try {
      const source = await readFile(join(cacheDir, doc.hash));
      if (sha256(source) !== doc.hash) throw new Error('原本のハッシュが一致しません');
      bytes.set(doc.id, source);
      if (/html/i.test(doc.contentType ?? '')) {
        const children = discoverChildren(decodeSource({ bytes: source, contentType: doc.contentType ?? '', url: doc.url }), { ...doc, documentType: documentType(doc.title) }, doc.lastAttemptAt);
        for (const child of children) {
          const existing = documents.get(child.id);
          if (existing) Object.assign(existing, { title: child.title, account: child.account, documentType: /html/i.test(existing.contentType ?? '') ? 'index' : child.documentType });
        }
      }
    } catch (error) { doc.validation.push(`再抽出できません: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const doc of next.documents) {
    const source = bytes.get(doc.id);
    if (!source || /html/i.test(doc.contentType ?? '') || doc.status === 'fetch_failed') continue;
    try {
      const result = await extractRequestDocument(source, doc);
      records.set(doc.id, result.records);
      const types = [...new Set(result.records.map(record => record.documentType))];
      if (types.length === 1) doc.documentType = types[0];
      Object.assign(doc, { status: result.status, recordCount: result.records.length, error: null,
        validation: [...doc.validation.filter(note => /同一URL|リダイレクト|再発見|最終成功|今回未取得|再抽出できません/.test(note)), ...result.validation] });
    } catch (error) {
      records.delete(doc.id); Object.assign(doc, { status: 'extraction_failed', recordCount: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  next.records = [...records.values()].flat();
  next.generatedAt = new Date().toISOString();
  next.coverage = { ...next.coverage, discoveredDocuments: next.documents.length, fetchedDocuments: next.documents.filter(doc => doc.retrievedAt).length,
    extractedDocuments: next.documents.filter(doc => doc.recordCount > 0).length, records: next.records.length,
    warnings: [...new Set([...next.coverage.warnings, '取得済みの原本だけで再抽出しました。原資料の再取得は行わず、取得日時を保持しています。', '標準明細表と対応CSV/TSV/XMLが対象です。概要図・画像PDF（OCR）・Excel・ZIP内包表・自由形式の要望/投資枠一覧は数値未対応です。'])] };
  const errors = validateBudgetRequests(next);
  if (errors.length) throw new Error(errors.join('\n'));
  return next;
}
async function main() {
  const year = Number(process.argv[2] ?? '2027');
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('Invalid year');
  const output = join(process.cwd(), 'public', 'data', `budget-requests-${year}.json.gz`);
  const data = JSON.parse(gunzipSync(await readFile(output)).toString('utf8')) as BudgetRequestDataset;
  const next = await reprocessBudgetRequests(data, join(process.cwd(), 'data', 'budget-requests', 'sources'));
  await writeFile(`${output}.tmp`, gzipSync(JSON.stringify(next), { level: 9 }));
  await rename(`${output}.tmp`, output);
  console.log(JSON.stringify(next.coverage, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
