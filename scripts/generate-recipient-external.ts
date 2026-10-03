/**
 * 支出先（法人番号）を外部情報と突き合わせる。
 *   npx tsx scripts/generate-recipient-external.ts [--refresh]
 * - 所在地・法人種別: RS公開APIの支払先（data/rs-api/{2026,2025,2024}。新しいシートを優先）
 * - Wikipedia・公式サイト・設立・説明: Wikidata の「法人番号」(P3225) で完全一致したものだけ
 * 入力の法人番号は支出先インデックス（recipient-index-2024/2025）から集める。
 * Wikidata の応答は data/cache/wikidata-corporate-number.json に保存し、再実行時は未取得分だけ問い合わせる。
 * 出力: public/data/recipient-external.json(.gz)
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { RecipientExternal, RecipientExternalFile } from '../types/recipient-external';

const refresh = process.argv.includes('--refresh');
const SHEETS = [2026, 2025, 2024];
const BATCH = 250;
const WIKIDATA = 'https://query.wikidata.org/sparql';
const CACHE = path.resolve('data/cache/wikidata-corporate-number.json');
const UA = 'rs-vis/1.0 (https://rs-vis.team-mir.ai; recipient enrichment)';

type WikidataHit = { item: string; label?: string; desc?: string; site?: string; wiki?: string; since?: string };

const corporateNumbers = new Set<string>();
for (const year of [2024, 2025]) {
  const index = JSON.parse(gunzipSync(fs.readFileSync(`public/data/recipient-index-${year}.json.gz`)).toString());
  for (const e of Object.values<{ corporateNumber: string }>(index.recipients)) if (/^\d{13}$/.test(e.corporateNumber)) corporateNumbers.add(e.corporateNumber);
}

// 1. RS公開API: 所在地・法人種別
const fromApi = new Map<string, { ad?: string; k?: string }>();
for (const sheet of SHEETS) {
  const root = path.resolve(`data/rs-api/${sheet}`);
  if (!fs.existsSync(path.join(root, 'projects.json'))) continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8')) as Array<{ id: string }>) {
    const file = path.join(root, p.id, 'payment-groups.json');
    if (!fs.existsSync(file)) continue;
    for (const g of JSON.parse(fs.readFileSync(file, 'utf8')).data as Array<{ payments: Array<{ corporate_number: string | null; corporate_address: string | null; corporate_kind: string | null }> }>) {
      for (const pay of g.payments) {
        const cn = pay.corporate_number;
        if (!cn || !corporateNumbers.has(cn) || fromApi.has(cn)) continue;
        fromApi.set(cn, { ...(pay.corporate_address?.trim() ? { ad: pay.corporate_address.trim() } : {}), ...(pay.corporate_kind ? { k: pay.corporate_kind } : {}) });
      }
    }
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
      if (wd.since) out.since = wd.since;
    }
    if (Object.keys(out).length > 0) byCn[cn] = out;
  }
  const file: RecipientExternalFile = {
    metadata: { generatedAt: new Date().toISOString(), corporateNumbers: corporateNumbers.size,
      sources: ['RS公開API（支払先の所在地・法人種別）', 'Wikidata（法人番号 P3225 の完全一致。CC0）'] },
    byCn,
  };
  const target = path.resolve('public/data/recipient-external.json');
  const text = JSON.stringify(file);
  fs.writeFileSync(target, text);
  fs.writeFileSync(`${target}.gz`, gzipSync(text, { level: 9 }));
  const values = Object.values(byCn);
  console.log(JSON.stringify({ corporateNumbers: corporateNumbers.size, written: values.length,
    address: values.filter(v => v.ad).length, wikidata: values.filter(v => v.wd).length,
    wikipedia: values.filter(v => v.wiki).length, website: values.filter(v => v.site).length }));
}

fetchWikidata().then(write).catch(error => { console.error(error); process.exit(1); });
