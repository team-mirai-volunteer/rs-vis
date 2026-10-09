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
/** Only demonstrated fiscal-year conventions count, not CMS folders or publication dates. */
function sourceFiscalYears(value: string): number[] {
  const path = new URL(value).pathname;
  const filename = path.split('/').at(-1) ?? '';
  return [
    ...[...filename.matchAll(/(?:^|[_-])(r|h)(\d{1,2})(?=[_.-])/gi)].map(match => Number(match[2]) + (match[1].toLowerCase() === 'r' ? 2018 : 1988)),
    ...[...path.matchAll(/(?:^|[/_-])fy(20\d{2})(?=[/_.-]|$)/gi)].map(match => Number(match[1])),
    ...[...path.matchAll(/\/(?:gaisan|soshiki|policies\/budget)\/r(\d{1,2})(?=\/|$)/gi)].map(match => Number(match[1]) + 2018),
    // MAFF and similar publishers encode the requested FY in r9yokyu, h31hojo, etc.
    // Do not interpret bare r01/r06 CMS directories (MEXT/ENV), r8request publication
    // names (Digital Agency), or YYYYMMDD timestamps as fiscal-year evidence.
    ...[...path.matchAll(/(?:^|[/_-])(r|h)(\d{1,2})(?=yokyu|youkyu|yosan|gaisan|hojo|hosei|yobihi|kettei|budget)/gi)]
      .map(match => Number(match[2]) + (match[1].toLowerCase() === 'r' ? 2018 : 1988)),
  ];
}
export function isCurrentRequestSource(value: string, year: number): boolean {
  const url = officialUrl(value);
  return !!url && sourceFiscalYears(url).every(sourceYear => sourceYear === year);
}
/** Stored requestedFY alone is not evidence that an old catalogue entry is current. */
export function isCurrentRequestDocument(doc: BudgetRequestDocument): boolean {
  const years = fiscalYears(doc.title);
  return isCurrentRequestSource(doc.url, doc.requestedFY) && (!years.length || years.includes(doc.requestedFY));
}
export function mainContent(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const main = clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main) return main;
  // MAFF uses a div rather than <main>. Stop at its balanced close so global
  // navigation does not inherit the final budget heading and enter the crawl.
  const container = /<(div|section|article)\b[^>]*\bclass\s*=\s*["']contentsBody["'][^>]*>/i.exec(clean)
    ?? /<(div|section|article)\b[^>]*\bid\s*=\s*["'](?:main_content|main-content|mainContent|contentsWrapper|contents)["'][^>]*>/i.exec(clean);
  if (container) {
    const start = container.index + container[0].length;
    const tags = new RegExp(`<(/?)${container[1]}\\b[^>]*>`, 'gi');
    tags.lastIndex = start;
    let depth = 1;
    for (let tag = tags.exec(clean); tag; tag = tags.exec(clean)) {
      depth += tag[1] ? -1 : 1;
      if (!depth) {
        const content = clean.slice(start, tag.index);
        const pageHeading = [...clean.slice(0, container.index).matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi)].at(-1)?.[0] ?? '';
        return /<h1\b/i.test(content) ? content : pageHeading + content;
      }
    }
  }
  const start = clean.search(/<h1\b/i);
  return start >= 0 ? clean.slice(start).split(/<!--\s*footer|<(?:div|section)[^>]+(?:id|class)=["'](?:footer|fnav|sitemap)/i)[0] : clean;
}
export interface OfficialLink { url: string; text: string; context: string; heading: string; headingPath?: string[]; }
function extractLinks(body: string, base: string): OfficialLink[] {
  const groups = [...body.matchAll(/<(tr|li)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(m => ({ start: m.index!, end: m.index! + m[0].length, html: m[0] }));
  const headings = [
    ...[...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ start: m.index!, level: Number(m[1]), text: plainText(m[2]), yearLabel: false })),
    // Fisheries uses standalone list items as section labels rather than h-tags.
    ...[...body.matchAll(/<(p|li|dt|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .filter(m => !/<a\b/i.test(m[2]) && /^(?:(?:令和|平成)(?:元|\d{1,2})|20\d{2})年度(?:予算)?$/.test(plainText(m[2]).normalize('NFKC').replace(/[\s【】〈〉《》＜＞<>\[\]（）()]/g, '')))
      .map(m => ({ start: m.index!, level: 0, text: plainText(m[2]), yearLabel: true })),
  ].sort((a, b) => a.start - b.start);
  const result: OfficialLink[] = [];
  const headingStack: typeof headings = [];
  let nextHeading = 0;
  for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    while (nextHeading < headings.length && headings[nextHeading].start < match.index!) {
      const next = { ...headings[nextHeading++] };
      if (next.yearLabel) {
        while (headingStack.at(-1)?.yearLabel) headingStack.pop();
        next.level = (headingStack.at(-1)?.level ?? 1) + 1;
      }
      while (headingStack.length && headingStack.at(-1)!.level >= next.level) headingStack.pop();
      headingStack.push(next);
    }
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw || raw.startsWith('#')) continue;
    const url = officialUrl(raw, base);
    if (!url || url === officialUrl(base)) continue;
    const group = groups.filter(g => g.start <= match.index! && g.end > match.index!).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const headingPath = headingStack.map(heading => heading.text);
    // Shared list/table containers must not lend one sibling link's year or
    // budget label to every unrelated link (e.g. MAFF's multi-link news list).
    const contextHtml = group?.html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor, offset: number) => group.start + offset === match.index ? anchor : '') ?? match[4];
    result.push({ url, text: plainText(match[4]), context: plainText(contextHtml), heading: headingPath.at(-1) ?? '', headingPath });
  }
  return result;
}
export function extractOfficialLinks(html: string, base: string): OfficialLink[] {
  return extractLinks(mainContent(html), base);
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
  if (special) return text.match(/[^\s（）()<>/]*特別会計/)?.[0].replace(/^[0-9０-９]+[.．、]*/, '') ?? '特別会計';
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
/** The closest year-bearing section wins; an undated subsection cannot erase its parent FY. */
function isCurrentRequestLink(link: OfficialLink, doc: BudgetRequestDocument, mixedYears: boolean): boolean {
  const domain = (url: string) => new URL(url).hostname.split('.').slice(-3).join('.');
  if (domain(link.url) !== domain(doc.url) || !isCurrentRequestSource(link.url, doc.requestedFY)) return false;
  if (!link.text && !link.context) return false;
  const isFile = /\.(pdf|csv|tsv|xml|xlsx?|zip)(?:\?|$)/i.test(link.url);
  const headingPath = link.headingPath ?? [link.heading];
  const headingYears = [...headingPath].reverse().map(fiscalYears).find(years => years.length) ?? [];
  const anchorYears = fiscalYears(link.text);
  const contextYears = fiscalYears(link.context);
  // Neutral departmental budget indexes are traversal portals, not current-year
  // files. MAFF places this h4 after its oldest h3 despite linking all bureaus.
  const budgetPortal = !isFile && !anchorYears.length && !contextYears.length && !fiscalYears(link.heading).length
    && /(?:各(?:局|府省|省庁)|部局|局庁).*予算/.test(link.heading) && !/決算|執行|配分|補正|概算決定/.test(link.heading);
  // A publisher may group next-FY requests under their publication-year heading
  // (e.g. CAA R9 requests under R8). Explicit anchor/row evidence is more specific.
  const declaredYears = [anchorYears, contextYears, ...(budgetPortal ? [] : [headingYears])].find(years => years.length) ?? [];
  if (declaredYears.length && !declaredYears.includes(doc.requestedFY)) return false;
  const currentScope = [...anchorYears, ...headingYears, ...contextYears, ...sourceFiscalYears(link.url)].includes(doc.requestedFY);
  // An undated section in a multi-year catalogue is not implicitly the requested year.
  if (mixedYears && !currentScope && !budgetPortal) return false;
  const label = `${headingPath.join(' ')} ${link.context}`;
  const specificLabel = `${link.heading} ${link.text}`;
  if (/税制改正|租税特別/.test(specificLabel)) return false;
  if (/機構.*定員|定員.*機構/.test(specificLabel) && !/予算|歳出/.test(specificLabel)) return false;
  if (/サイトマップ|リンク集|問[い合]*わせ|問合せ/.test(link.heading)) return false;
  const inheritedRequest = !mixedYears && fiscalYears(doc.title).includes(doc.requestedFY) && /概算|要求|要望|投資枠/.test(doc.title);
  // Ancestor request context can explain a generic PDF, but cannot make a
  // sidebar or unrelated HTML page a request landing page.
  const localLabel = `${link.heading} ${link.context}`;
  const relevant = /概算|要求|要望|投資枠|歳出|予算|一般会計|特別会計/.test(isFile ? label : localLabel) || /政策評価調書/.test(link.context) || (isFile && inheritedRequest);
  if (!isFile && (!relevant || /トップ|ホーム|過去|決算|執行|調達|採用|リンク集|問い合わせ|問合せ|受付/.test(link.text))) return false;
  if (!isFile && !currentScope && !budgetPortal && !/概算|要求|要望|投資枠/.test(localLabel)) return false;
  if (isFile && !relevant && !['accounting_table', 'demand_list', 'investment_list'].includes(doc.documentType)) return false;
  return true;
}
function currentChildLinks(html: string, doc: BudgetRequestDocument): OfficialLink[] {
  if (!isCurrentRequestDocument(doc)) return [];
  const body = mainContent(html);
  const mixedYears = fiscalYears(plainText(body)).some(year => year !== doc.requestedFY);
  return extractLinks(body, doc.url).filter(link => isCurrentRequestLink(link, doc, mixedYears));
}
/** Only observed rejected links are evidence for cleanup; a disappeared link is not. */
export function discoverExcludedChildUrls(html: string, doc: BudgetRequestDocument): string[] {
  const included = new Set(currentChildLinks(html, doc).map(link => link.url));
  // Include links outside main content: legacy crawls admitted footer/sidebar URLs.
  const observed = extractLinks(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ''), doc.url);
  return [...new Set(observed.map(link => link.url).filter(url => !included.has(url)))];
}
export function discoverChildren(html: string, doc: BudgetRequestDocument, now: string): BudgetRequestDocument[] {
  const seen = new Set<string>();
  return currentChildLinks(html, doc).flatMap(link => {
    if (seen.has(link.url)) return [];
    seen.add(link.url);
    const accounts = [link.text, link.context, ...[...(link.headingPath ?? [link.heading])].reverse()].map(accountFromText);
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
