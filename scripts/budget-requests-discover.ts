/** Conservative, bounded discovery from MOF's published links. Never synthesizes ministry URLs. */
import { createHash } from 'node:crypto';
import type { BudgetRequestDocument, RequestDocumentType } from '../types/budget-requests';

export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function plainText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, value: string) => String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
    .replace(/&(?:nbsp|emsp|ensp);/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}
export function officialUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value.trim().replace(/&amp;/g, '&'), base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !/(^|\.)[a-z0-9-]+\.go\.jp$/i.test(url.hostname)) return null;
    // WARP can replay arbitrary publishers and prior years; it is not a current official source.
    if (/(^|\.)warp\.ndl\.go\.jp$/i.test(url.hostname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
/** Only explicit fiscal-year path markers count; a publication date may precede the requested FY. */
export function isCurrentRequestSource(value: string, year: number): boolean {
  const url = officialUrl(value);
  if (!url) return false;
  const path = new URL(url).pathname;
  const years = [
    ...[...path.matchAll(/\/fy(20\d{2})(?=\/|$)/gi)].map(match => Number(match[1])),
    ...[...path.matchAll(/\/(?:gaisan|soshiki)\/r(\d{1,2})(?=\/|$)/gi)].map(match => Number(match[1]) + 2018),
  ];
  return years.every(sourceYear => sourceYear === year);
}
export function mainContent(html: string): string {
  const clean = html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const main = clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main) return main;
  const start = clean.search(/<h1\b/i);
  return start >= 0 ? clean.slice(start).split(/<!--\s*footer|<div[^>]+id=["'](?:footer|fnav)/i)[0] : clean;
}
export interface OfficialLink { url: string; text: string; context: string; heading: string; }
export function extractOfficialLinks(html: string, base: string): OfficialLink[] {
  const body = mainContent(html);
  const groups = [...body.matchAll(/<(tr|li)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(m => ({ start: m.index!, end: m.index! + m[0].length, html: m[0] }));
  const headings = [...body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(m => ({ start: m.index!, text: plainText(m[1]) }));
  const result: OfficialLink[] = [];
  for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw || raw.startsWith('#')) continue;
    const url = officialUrl(raw, base);
    if (!url || url === officialUrl(base)) continue;
    const group = groups.filter(g => g.start <= match.index! && g.end > match.index!).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const heading = headings.filter(h => h.start < match.index!).at(-1)?.text ?? '';
    result.push({ url, text: plainText(match[4]), context: plainText(group?.html ?? match[4]), heading });
  }
  return result;
}
export function documentType(text: string, fallback: RequestDocumentType = 'unknown'): RequestDocumentType {
  if (/概要|主要事項|重点施策/.test(text) && !/要望一覧|投資枠.*一覧/.test(text)) return 'overview';
  const frames = [/概算要求書|要求額明細|歳出|一般会計|特別会計/.test(text), /要望/.test(text), /投資枠/.test(text)];
  if (frames.filter(Boolean).length > 1) return 'unknown';
  if (frames[1]) return 'demand_list';
  if (frames[2]) return 'investment_list';
  if (/概要|主要事項|重点施策/.test(text)) return 'overview';
  if (frames[0]) return 'accounting_table';
  return fallback;
}
/** undefined=no account stated; null=conflicting source labels, never assume general. */
export function accountFromText(text: string): string | null | undefined {
  const general = /一般会計/.test(text), special = /特別会計/.test(text);
  if (general && special) return null;
  if (general) return '一般会計';
  if (special) return text.match(/[^\s（）()<>/]*特別会計/)?.[0] ?? '特別会計';
  return undefined;
}
export function sourceDocument(url: string, title: string, ministry: string, year: number, now: string, parentUrl: string | null, account: string | null, type: RequestDocumentType): BudgetRequestDocument {
  return { id: `doc-${sha256(`${year}:${ministry}:${url}`).slice(0, 20)}`, url, title, ministry, account, documentType: type, parentUrl, requestedFY: year, status: 'discovered', retrievedAt: null, lastAttemptAt: now, hash: null, revision: 0, revisions: [], contentType: null, recordCount: 0, error: null, validation: [] };
}
/** The three catalogue URLs must be present as real anchors in the fiscal-year index. */
export function discoverCatalogues(html: string, base: string): OfficialLink[] {
  const year = Number(new URL(base).pathname.match(/\/fy(20\d{2})(?:\/|$)/i)?.[1]);
  return extractOfficialLinks(html, base).filter(link => /^(?:概算要求の概要等|一般会計|特別会計)$/.test(link.text) && (!year || isCurrentRequestSource(link.url, year)));
}
/** One source per distinct ministry/URL. Empty cells remain absent; they are never fabricated URLs. */
export function discoverMinistries(html: string, catalogue: OfficialLink, year: number, now: string, known: BudgetRequestDocument[] = []): BudgetRequestDocument[] {
  const result: BudgetRequestDocument[] = [];
  const seen = new Set<string>();
  for (const row of mainContent(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (!cells.length) continue;
    const rowLabel = plainText(cells[0][1]).replace(/\s/g, '').replace(/^内閣本府$/, '内閣府').replace(/^カジノ監理委員会$/, 'カジノ管理委員会');
    if (!rowLabel || /会計名|概算要求|要望|所管名/.test(rowLabel) || ['国会', '内閣', '皇室費'].includes(rowLabel)) continue;
    for (const link of extractOfficialLinks(row[1], catalogue.url)) {
      if (!isCurrentRequestSource(link.url, year)) continue;
      const exact = known.find(d => d.url === link.url);
      const candidates = [...new Set(known.filter(d => new URL(d.url).hostname === new URL(link.url).hostname).map(d => d.ministry))];
      const ministry = catalogue.text === '特別会計' ? (exact?.ministry ?? (candidates.length === 1 ? candidates[0] : '所管未判定')) : rowLabel;
      const key = `${ministry}:${link.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const account = catalogue.text === '一般会計' ? '一般会計' : catalogue.text === '特別会計' ? `特別会計（${rowLabel}）` : null;
      result.push(sourceDocument(link.url, `${ministry} ${catalogue.text}`, ministry, year, now, catalogue.url, account, /概要/.test(catalogue.text) ? 'overview' : 'accounting_table'));
    }
  }
  return result;
}
export function fiscalYears(text: string): number[] {
  const normalized = text.normalize('NFKC').replace(/\s/g, '');
  return [...new Set([...normalized.matchAll(/令和(元|\d{1,2})年度|平成(元|\d{1,2})年度|(20\d{2})年度/g)].map(m => m[1] ? 2018 + (m[1] === '元' ? 1 : Number(m[1])) : m[2] ? 1988 + (m[2] === '元' ? 1 : Number(m[2])) : Number(m[3])))];
}
export function discoverChildren(html: string, doc: BudgetRequestDocument, now: string): BudgetRequestDocument[] {
  if (!isCurrentRequestSource(doc.url, doc.requestedFY)) return [];
  const seen = new Set<string>();
  return extractOfficialLinks(html, doc.url).flatMap(link => {
    const domain = (url: string) => new URL(url).hostname.split('.').slice(-3).join('.');
    if (domain(link.url) !== domain(doc.url)) return []; // Cross-ministry reference links are not this ministry's requests.
    if (!isCurrentRequestSource(link.url, doc.requestedFY)) return [];
    const label = `${link.heading} ${link.context}`;
    if (/税制改正|租税特別|機構.*定員|定員.*機構/.test(link.heading)) return [];
    const anchorYears = fiscalYears(link.text);
    if (anchorYears.length && !anchorYears.includes(doc.requestedFY)) return [];
    const years = fiscalYears(label);
    if (years.length && !years.includes(doc.requestedFY)) return [];
    const isFile = /\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i.test(link.url);
    const relevant = /概算|要求|要望|投資枠|歳出|予算|一般会計|特別会計/.test(label);
    // Landing pages are followed only when their labels say they concern budget requests.
    if (!isFile && (!relevant || /トップ|過去|決算|執行|調達|採用|リンク集|問い合わせ/.test(link.text))) return [];
    if (isFile && !relevant && !['accounting_table', 'demand_list', 'investment_list'].includes(doc.documentType)) return [];
    if (seen.has(link.url)) return [];
    seen.add(link.url);
    const accounts = [link.text, link.context, link.heading].map(accountFromText);
    const declaredAccount = accounts.find(account => account !== undefined);
    const account = declaredAccount === undefined ? doc.account : declaredAccount;
    const specific = documentType(link.text);
    const inferred = specific !== 'unknown' ? specific : documentType(link.heading, documentType(link.context, doc.documentType));
    const title = [link.heading, /^(?:PDF|\(?PDF形式|[○〇])/.test(link.text.normalize('NFKC')) ? link.context : link.text].filter(Boolean).join(' / ').slice(0, 500);
    const child = sourceDocument(link.url, title || link.text || doc.title, doc.ministry, doc.requestedFY, now, doc.url, account, inferred);
    if ((/歳入/.test(link.text) || /(?:^|[/_-])sainyu/i.test(link.url)) && !/歳出/.test(link.text)) { child.status = 'unsupported'; child.validation.push('歳入資料は歳出概算要求の抽出対象外'); }
    return [child];
  });
}
