/**
 * 支出先（法人番号）を外部情報と突き合わせる。
 *   npx tsx scripts/generate-recipient-external.ts [--refresh]
 * - 所在地・法人種別: 公式CSV（5-1）。CSV の無い 2026 シートは RS公開APIの支払先（新しいシートを優先）
 * - Wikipedia・公式サイト・設立・説明: Wikidata の「法人番号」(P3225) で完全一致したものだけ
 * - Wikipedia の冒頭: 上で得た日本語版記事のリード文の最初の1〜2文（CC BY-SA。画面で出典を示す）
 * 入力の法人番号は支出先インデックス（recipient-index-2024/2025）から集める。
 * Wikidata・Wikipedia の応答は data/cache/ に保存し、再実行時は未取得分だけ問い合わせる。
 * 出力: public/data/recipient-external.json(.gz)
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { RecipientExternal, RecipientExternalFile } from '../types/recipient-external';
import { loadSheetGroups } from './rs-sheet-groups';

const refresh = process.argv.includes('--refresh');
const SHEETS = [2026, 2025, 2024];
const BATCH = 250;
const WIKIDATA = 'https://query.wikidata.org/sparql';
const CACHE = path.resolve('data/cache/wikidata-corporate-number.json');
const WIKI_CACHE = path.resolve('data/cache/wikipedia-extracts.json');
const WIKIPEDIA = 'https://ja.wikipedia.org/w/api.php';
const UA = 'rs-vis/1.0 (https://rs-vis.team-mir.ai; recipient enrichment)';

type WikidataHit = { item: string; label?: string; desc?: string; site?: string; wiki?: string; since?: string };

const corporateNumbers = new Set<string>();
for (const year of [2024, 2025]) {
  const index = JSON.parse(gunzipSync(fs.readFileSync(`public/data/recipient-index-${year}.json.gz`)).toString());
  for (const e of Object.values<{ corporateNumber: string }>(index.recipients)) if (/^\d{13}$/.test(e.corporateNumber)) corporateNumbers.add(e.corporateNumber);
}

// 1. 所在地・法人種別: 公式CSV（5-1）。CSV の無い年度（2026 シート）は RS公開API（scripts/rs-sheet-groups.ts）。新しいシートを優先し、空欄は古いシートで埋める
const fromApi = new Map<string, { ad?: string; k?: string }>();
for (const sheet of SHEETS) {
  let groups;
  try { groups = loadSheetGroups(sheet); } catch { continue; }
  for (const list of groups.byPid.values()) for (const g of list) for (const pay of g.payments) {
    const cn = pay.corporate_number;
    if (!cn || !corporateNumbers.has(cn)) continue;
    const cur = fromApi.get(cn) ?? {};
    if (!cur.ad && pay.corporate_address?.trim()) cur.ad = pay.corporate_address.trim();
    if (!cur.k && pay.corporate_kind) cur.k = pay.corporate_kind;
    fromApi.set(cn, cur);
  }
}

// 2. Wikidata: 法人番号の完全一致
const cache: Record<string, WikidataHit | null> = !refresh && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const pending = [...corporateNumbers].filter(cn => !(cn in cache)).sort();
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function query(cns: string[]) {
  const sparql = `SELECT ?cn ?item ?itemLabel ?itemDescription ?site ?article ?inception WHERE {
  VALUES ?cn { ${cns.map(cn => `"${cn}"`).join(' ')} }
  ?item wdt:P3225 ?cn .
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(WIKIDATA, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
        body: new URLSearchParams({ query: sparql }), signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      return (await res.json()).results.bindings as Array<Record<string, { value: string }>>;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(5000 * 2 ** attempt);
    }
  }
  return [];
}
/** 公式サイトが複数あるときは日本語ページを優先する */
const preferSite = (a: string | undefined, b: string) => !a ? b : /\/ja(\/|-|$)|\.jp\//.test(b) && !/\/ja(\/|-|$)|\.jp\//.test(a) ? b : a;
async function fetchWikidata() {
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const rows = await query(batch);
    for (const cn of batch) cache[cn] = null;
    for (const r of rows) {
      const cn = r.cn.value;
      const prev = cache[cn];
      // 1つの法人番号に複数の項目が付くことがある（旧称・子会社の誤付与など）。最初の項目を採り、同じ項目の行だけ統合する
      if (prev && prev.item !== r.item.value) continue;
      const hit: WikidataHit = prev ?? { item: r.item.value };
      if (r.itemLabel?.value && !/^Q\d+$/.test(r.itemLabel.value)) hit.label = r.itemLabel.value;
      if (r.itemDescription?.value) hit.desc = r.itemDescription.value;
      if (r.site?.value) hit.site = preferSite(hit.site, r.site.value);
      if (r.article?.value) hit.wiki = decodeURIComponent(r.article.value);
      if (r.inception?.value) hit.since = r.inception.value.slice(0, 10);
      cache[cn] = hit;
    }
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    console.log(`Wikidata ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
    await delay(1500);
  }
}

/** リード文の最初の段落から、120字に届くまで（最大2文）を取り、220字で切る */
function leadSentences(extract: string): string | undefined {
  const paragraph = extract.split('\n').map(line => line.trim()).find(line => line.length > 0);
  if (!paragraph) return undefined;
  const sentences = paragraph.match(/[^。]+。?/g) ?? [paragraph];
  let text = '';
  for (const sentence of sentences.slice(0, 2)) {
    text += sentence;
    if (text.length >= 120) break;
  }
  return text.length > 220 ? `${text.slice(0, 219)}…` : text;
}

const wikiCache: Record<string, string | null> = !refresh && fs.existsSync(WIKI_CACHE) ? JSON.parse(fs.readFileSync(WIKI_CACHE, 'utf8')) : {};
const titleOf = (url: string) => decodeURIComponent(url.replace('https://ja.wikipedia.org/wiki/', '')).replace(/_/g, ' ');
async function fetchWikipedia() {
  const titles = [...new Set(Object.values(cache).flatMap(hit => (hit?.wiki ? [titleOf(hit.wiki)] : [])))].filter(t => !(t in wikiCache)).sort();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const url = new URL(WIKIPEDIA);
    Object.entries({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: 'max', redirects: '1', format: 'json', formatversion: '2', titles: batch.join('|') })
      .forEach(([k, v]) => url.searchParams.set(k, v));
    let body: { query?: { pages?: Array<{ title: string; extract?: string }>; normalized?: Array<{ from: string; to: string }>; redirects?: Array<{ from: string; to: string }> } } = {};
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw Error(`HTTP ${res.status}`);
        body = await res.json();
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await delay(3000 * 2 ** attempt);
      }
    }
    // 要求した表記 → 正規化・リダイレクト後の記事名をたどって、元の表記に結果を戻す
    const step = new Map<string, string>([...(body.query?.normalized ?? []), ...(body.query?.redirects ?? [])].map(m => [m.from, m.to]));
    const resolve = (t: string) => { let cur = t; for (let n = 0; n < 3 && step.has(cur); n++) cur = step.get(cur)!; return cur; };
    const extracts = new Map((body.query?.pages ?? []).map(page => [page.title, page.extract ?? '']));
    for (const t of batch) wikiCache[t] = leadSentences(extracts.get(resolve(t)) ?? '') ?? null;
    fs.writeFileSync(WIKI_CACHE, JSON.stringify(wikiCache));
    if ((i / 20) % 25 === 0) console.log(`Wikipedia ${Math.min(i + 20, titles.length)}/${titles.length}`);
    await delay(300);
  }
}

function write() {
  // 3. 出力（どちらにも無い法人番号はキーを作らない）
  const byCn: Record<string, RecipientExternal> = {};
  for (const cn of [...corporateNumbers].sort()) {
    const api = fromApi.get(cn);
    const wd = cache[cn];
    const out: RecipientExternal = { ...api };
    if (wd) {
      out.wd = wd.item.replace('http://www.wikidata.org/entity/', '');
      if (wd.label) out.label = wd.label;
      if (wd.desc) out.desc = wd.desc;
      if (wd.site) out.site = wd.site;
      if (wd.wiki) out.wiki = wd.wiki;
      const lead = wd.wiki ? wikiCache[titleOf(wd.wiki)] : null;
      if (lead) out.wt = lead;
      if (wd.since) out.since = wd.since;
    }
    if (Object.keys(out).length > 0) byCn[cn] = out;
  }
  const file: RecipientExternalFile = {
    metadata: { generatedAt: new Date().toISOString(), corporateNumbers: corporateNumbers.size,
      sources: ['RSシート5-1（所在地・法人種別。2026シートは RS公開API）', 'Wikidata（法人番号 P3225 の完全一致。CC0）', 'Wikipedia 日本語版のリード文の冒頭（CC BY-SA 4.0）'] },
    byCn,
  };
  const target = path.resolve('public/data/recipient-external.json');
  const text = JSON.stringify(file);
  fs.writeFileSync(target, text);
  fs.writeFileSync(`${target}.gz`, gzipSync(text, { level: 9 }));
  const values = Object.values(byCn);
  console.log(JSON.stringify({ corporateNumbers: corporateNumbers.size, written: values.length,
    address: values.filter(v => v.ad).length, wikidata: values.filter(v => v.wd).length,
    wikipedia: values.filter(v => v.wiki).length, wikipediaLead: values.filter(v => v.wt).length, website: values.filter(v => v.site).length }));
}

fetchWikidata().then(fetchWikipedia).then(write).catch(error => { console.error(error); process.exit(1); });
