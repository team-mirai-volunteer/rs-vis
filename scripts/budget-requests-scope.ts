/** Recheck saved catalogue edges against the current-cycle discovery rules. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BudgetRequestDataset } from '../types/budget-requests';
import { discoverChildren, discoverExcludedChildUrls, documentType, isCurrentRequestDocument, sha256 } from './budget-requests-discover';

export async function currentCycleSnapshot(data: BudgetRequestDataset, cacheDir: string): Promise<{ dataset: BudgetRequestDataset; excluded: string[] }> {
  const next = structuredClone(data);
  const acceptedBy = new Map<string, Set<string>>();
  const rejectedBy = new Map<string, Set<string>>();
  const key = (ministry: string, url: string) => `${ministry}:${url}`;
  const add = (map: Map<string, Set<string>>, child: string, parent: string) => {
    const parents = map.get(child) ?? new Set<string>(); parents.add(parent); map.set(child, parents);
  };
  const excluded = new Set(next.documents.filter(doc => !isCurrentRequestDocument(doc)).map(doc => key(doc.ministry, doc.url)));
  for (const doc of next.documents) {
    if (!doc.hash || !/html/i.test(doc.contentType ?? '') || excluded.has(key(doc.ministry, doc.url))) continue;
    try {
      const bytes = await readFile(join(cacheDir, doc.hash));
      if (sha256(bytes) !== doc.hash) continue;
      const prefix = bytes.subarray(0, 2000).toString('ascii');
      const encoding = doc.contentType?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? prefix.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? 'utf-8';
      let html: string;
      try { html = new TextDecoder(encoding).decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
      const parent = { ...doc, documentType: documentType(doc.title) };
      const parentKey = key(doc.ministry, doc.url);
      for (const child of discoverChildren(html, parent, doc.lastAttemptAt)) add(acceptedBy, key(child.ministry, child.url), parentKey);
      for (const url of discoverExcludedChildUrls(html, parent)) add(rejectedBy, key(doc.ministry, url), parentKey);
    } catch { /* A missing or corrupt parent is not evidence that its children are out of scope. */ }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const doc of next.documents) {
      const docKey = key(doc.ministry, doc.url);
      if (excluded.has(docKey)) continue;
      // National catalogue roots are independently authoritative. A ministry's
      // footer must not erase a root that MOF explicitly lists for this cycle.
      if (doc.ministry === '全府省' || (doc.parentUrl && new URL(doc.parentUrl).hostname === 'www.mof.go.jp' && new URL(doc.parentUrl).pathname.includes(`/fy${data.requestedFY}/`))) continue;
      const parents = acceptedBy.get(docKey);
      if (parents && [...parents].some(parent => !excluded.has(parent))) continue;
      const storedParent = doc.parentUrl ? key(doc.ministry, doc.parentUrl) : null;
      if (storedParent && (excluded.has(storedParent) || rejectedBy.get(docKey)?.has(storedParent))) {
        excluded.add(docKey); changed = true;
      }
    }
  }
  next.documents = next.documents.filter(doc => !excluded.has(key(doc.ministry, doc.url)));
  const ids = new Set(next.documents.map(doc => doc.id));
  next.records = next.records.filter(record => ids.has(record.documentId));
  return { dataset: next, excluded: data.documents.filter(doc => !ids.has(doc.id)).map(doc => doc.id) };
}
