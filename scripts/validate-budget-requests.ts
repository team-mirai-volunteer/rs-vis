import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import type { BudgetRequestDataset, RequestAmount } from '../types/budget-requests';
import { officialUrl } from './budget-requests-discover';

export function validateBudgetRequests(data: BudgetRequestDataset): string[] {
  const errors: string[] = [];
  const documents = new Map(data.documents.map(d => [d.id, d]));
  const recordIds = new Set(data.records.map(r => r.id));
  if (data.schemaVersion !== 1) errors.push('Unsupported schema');
  if (documents.size !== data.documents.length) errors.push('Duplicate document IDs');
  if (recordIds.size !== data.records.length) errors.push('Duplicate record IDs');
  const amount = (value: RequestAmount, context: string) => {
    if (!['numeric', '事項要求', 'blank', 'extraction_failed'].includes(value.status)) errors.push(`${context}: invalid amount status`);
    if (value.status === 'numeric' ? !Number.isSafeInteger(value.valueYen) : value.valueYen !== null) errors.push(`${context}: status/value mismatch`);
    if (value.status === 'numeric' && !value.raw.trim()) errors.push(`${context}: numeric value has no source text`);
  };
  for (const doc of data.documents) {
    if (!officialUrl(doc.url)) errors.push(`${doc.id}: non-official source`);
    if (doc.requestedFY !== data.requestedFY) errors.push(`${doc.id}: fiscal year mismatch`);
    if (doc.hash && !/^[a-f0-9]{64}$/.test(doc.hash)) errors.push(`${doc.id}: invalid digest`);
    if (doc.hash && !doc.revisions.some(rev => rev.hash === doc.hash && rev.revision === doc.revision)) errors.push(`${doc.id}: missing revision`);
    if (doc.recordCount !== data.records.filter(r => r.documentId === doc.id).length) errors.push(`${doc.id}: record count mismatch`);
  }
  for (const record of data.records) {
    const doc = documents.get(record.documentId);
    if (!doc) { errors.push(`${record.id}: missing document`); continue; }
    if (record.provenance.hash !== doc.hash) errors.push(`${record.id}: source digest mismatch`);
    if (record.provenance.url !== doc.url) errors.push(`${record.id}: source URL mismatch`);
    if (record.requestedFY !== data.requestedFY) errors.push(`${record.id}: fiscal year mismatch`);
    if (!record.provenance.rawQuote.trim() || !record.provenance.extractionMethod) errors.push(`${record.id}: missing evidence`);
    if (record.provenance.page !== null && (!Number.isInteger(record.provenance.page) || record.provenance.page < 1)) errors.push(`${record.id}: invalid page`);
    if (record.parentId !== null && !recordIds.has(record.parentId)) errors.push(`${record.id}: missing parent`);
    for (const [key, value] of Object.entries(record.amounts)) amount(value, `${record.id}/${key}`);
    amount(record.previousYear, `${record.id}/previousYear`);
    if (record.rsLink.status === 'exact' && (!record.rsLink.evidence || !record.rsLink.projectIds.length || !record.rsLink.sheetFY)) errors.push(`${record.id}: exact RS link missing evidence`);
  }
  if (data.coverage.discoveredDocuments !== data.documents.length || data.coverage.records !== data.records.length) errors.push('Coverage counts disagree');
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const year = Number(process.argv[2] ?? '2027');
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('Invalid year');
  const data = JSON.parse(gunzipSync(readFileSync(`public/data/budget-requests-${year}.json.gz`)).toString('utf8')) as BudgetRequestDataset;
  const errors = validateBudgetRequests(data);
  if (!data.records.length || !data.coverage.ministries) errors.push('No extracted requests or ministry catalogue; do not publish an empty replacement');
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Budget requests validated: ${data.documents.length} source documents, ${data.records.length} records. Coverage remains partial.`);
}
