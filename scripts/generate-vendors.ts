/**
 * 事業者別の横断集計を作る。契約方式データ（contract-methods-{シート年度}.json(.gz)）を
 * 法人番号（無ければ正規化した名前）でまとめ、全府省での受注・1者応札・随意契約を事業者ごとに出す。
 *   npx tsx scripts/generate-vendors.ts
 * 出力: public/data/vendors.json(.gz)
 * 収録: いずれかの年度に契約（入札・随意契約・国庫債務負担行為）が1件以上ある事業者。補助金だけの相手は含めない。
 * 「その他」「受給者」など特定の相手ではない記載は除く（app/lib/recipient-profile の genericRecipientNote と同じ判定）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { contractCategory, type ContractMethodEntry, type ContractMethodsByPid } from '../app/lib/contract-method';
import { isValidCorporateNumber, normalizeRecipientName } from '../app/lib/recipient-key';
import { genericRecipientNote } from '../app/lib/recipient-profile';
import { emptyVendorYear, VENDOR_MINISTRY_LIMIT, VENDOR_REPEAT_LIMIT, VENDOR_YEAR_FIELDS } from '../app/lib/vendors';
import type { Vendor, VendorRepeatProject, VendorYear, VendorsFile } from '../types/vendors';
import type { RecipientExternalFile } from '../types/recipient-external';

const SHEET_YEARS = [2024, 2025, 2026];

function readJson<T>(name: string): T | null {
  const base = path.resolve('public/data', name);
  if (fs.existsSync(base)) return JSON.parse(fs.readFileSync(base, 'utf8')) as T;
  if (fs.existsSync(`${base}.gz`)) return JSON.parse(gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf8')) as T;
  return null;
}

/** 事業ID → 事業名・府省。シート2026の事業名データは無いので 2025 → 2024 の順に引く */
const labels = new Map<string, { name: string; ministry: string }>();
for (const y of [2024, 2025]) {
  const items = readJson<Array<{ pid: number | string; name: string; ministry: string }>>(`project-quality-scores-${y}.json`) ?? [];
  for (const p of items) labels.set(String(p.pid), { name: p.name, ministry: p.ministry });
}
const external = readJson<RecipientExternalFile>('recipient-external.json');

type Acc = {
  key: string; cn: string; names: Map<string, number>;
  years: Map<number, VendorYear>;
  /** 年度ごとの事業・府省の集合（件数を数えるため） */
  pids: Map<number, Set<string>>; mins: Map<number, Set<string>>;
  /** 府省 → 契約金額・事業の集合（全年度） */
  byMinistry: Map<string, { amount: number; pids: Set<string> }>;
  /** 事業 → 年度 → 競争入札の1者応札の金額 */
  singleByPid: Map<string, Map<number, number>>;
  /** 事業 → 競争なしの随意契約があった年度 */
  soleByPid: Map<string, Set<number>>;
};
const byKey = new Map<string, Acc>();

const vendorKey = (e: ContractMethodEntry): string | null => {
  if (genericRecipientNote(e.n)) return null;
  const name = normalizeRecipientName(e.n);
  if (!name) return null;
  return isValidCorporateNumber(e.cn) ? e.cn.trim() : `name:${name}`;
};

for (const sheetYear of SHEET_YEARS) {
  const file = readJson<ContractMethodsByPid>(`contract-methods-${sheetYear}.json`);
  if (!file) { console.warn(`skip ${sheetYear}: contract-methods-${sheetYear}.json が無い`); continue; }
  for (const [pid, entries] of Object.entries(file)) {
    const ministry = labels.get(pid)?.ministry ?? '';
    for (const e of entries) {
      const key = vendorKey(e);
      if (!key) continue;
      const acc: Acc = byKey.get(key) ?? { key, cn: key.startsWith('name:') ? '' : key, names: new Map(), years: new Map(), pids: new Map(), mins: new Map(),
        byMinistry: new Map(), singleByPid: new Map(), soleByPid: new Map() };
      byKey.set(key, acc);
      acc.names.set(e.n, (acc.names.get(e.n) ?? 0) + 1);
      const y = acc.years.get(sheetYear) ?? emptyVendorYear(sheetYear);
      acc.years.set(sheetYear, y);
      const a = e.a ?? 0;
      const category = contractCategory(e.m);
      y.amount += a; y.count++;
      if (category === 'non-contract') { y.nonContractAmount += a; }
      else {
        y.contractAmount += a; y.contractCount++;
        const bm = acc.byMinistry.get(ministry) ?? { amount: 0, pids: new Set<string>() };
        bm.amount += a; bm.pids.add(pid); acc.byMinistry.set(ministry, bm);
      }
      (acc.pids.get(sheetYear) ?? acc.pids.set(sheetYear, new Set()).get(sheetYear)!).add(pid);
      if (ministry) (acc.mins.get(sheetYear) ?? acc.mins.set(sheetYear, new Set()).get(sheetYear)!).add(ministry);
      if (category === 'open' || category === 'selective') {
        y.competitiveCount++; y.competitiveAmount += a;
        if (e.ap !== undefined) {
          y.competitiveWithApplicants++;
          if (e.ap === 1) {
            y.singleCount++; y.singleAmount += a;
            const m = acc.singleByPid.get(pid) ?? new Map<number, number>();
            m.set(sheetYear, (m.get(sheetYear) ?? 0) + a); acc.singleByPid.set(pid, m);
            if (e.br !== undefined) { y.singleBidRateSum += e.br; y.singleBidRateN++; }
          } else if (e.br !== undefined) { y.multiBidRateSum += e.br; y.multiBidRateN++; }
        }
      } else if (category === 'negotiated-sole') {
        y.soleCount++; y.soleAmount += a;
        (acc.soleByPid.get(pid) ?? acc.soleByPid.set(pid, new Set()).get(pid)!).add(sheetYear);
      } else if (category === 'negotiated-competitive') { y.negotiatedCompetitiveCount++; y.negotiatedCompetitiveAmount += a; }
      else if (category === 'multi-year') { y.multiYearAmount += a; }
    }
  }
}

const vendors: Vendor[] = [];
for (const acc of byKey.values()) {
  const years = [...acc.years.values()].sort((a, b) => a.sheetYear - b.sheetYear);
  for (const y of years) { y.projects = acc.pids.get(y.sheetYear)?.size ?? 0; y.ministries = acc.mins.get(y.sheetYear)?.size ?? 0; }
  if (!years.some(y => y.contractCount > 0)) continue;
  const total = emptyVendorYear(0);
  for (const y of years) for (const k of VENDOR_YEAR_FIELDS) total[k] += y[k];
  total.projects = new Set([...acc.pids.values()].flatMap(s => [...s])).size;
  total.ministries = new Set([...acc.mins.values()].flatMap(s => [...s])).size;
  const name = [...acc.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))[0][0];
  const repeat: VendorRepeatProject[] = [];
  for (const [pid, perYear] of acc.singleByPid) {
    if (perYear.size < 2) continue;
    const info = labels.get(pid);
    repeat.push({ pid, ...(info ? { name: info.name, ministry: info.ministry } : {}), sheetYears: [...perYear.keys()].sort(), amount: [...perYear.values()].reduce((s, v) => s + v, 0) });
  }
  repeat.sort((a, b) => b.amount - a.amount || Number(a.pid) - Number(b.pid));
  const ministries = [...acc.byMinistry.entries()].filter(([m]) => m).map(([ministry, v]) => ({ ministry, amount: v.amount, projects: v.pids.size }))
    .sort((a, b) => b.amount - a.amount).slice(0, VENDOR_MINISTRY_LIMIT);
  const kind = acc.cn ? external?.byCn[acc.cn]?.k : undefined;
  vendors.push({ key: acc.key, name, corporateNumber: acc.cn, ...(kind ? { kind } : {}), years, total, ministries,
    repeatSingle: repeat.slice(0, VENDOR_REPEAT_LIMIT), repeatSingleCount: repeat.length,
    repeatSoleCount: [...acc.soleByPid.values()].filter(s => s.size >= 2).length });
}
vendors.sort((a, b) => b.total.contractAmount - a.total.contractAmount || a.key.localeCompare(b.key));

const out: VendorsFile = {
  metadata: {
    generatedAt: new Date().toISOString(),
    sheetYears: SHEET_YEARS,
    source: 'RS公開APIの契約方式（contract-methods-{シート年度}.json）。シート年度 N の契約は年度 N−1 の実績（2026 は 2025年度の暫定）',
    inclusion: 'いずれかの年度に契約（入札・随意契約・国庫債務負担行為）が1件以上ある事業者。補助金・交付金だけの相手と、「その他」「受給者」など特定の相手ではない記載は含めない',
    notes: [
      '事業者は法人番号でまとめ、番号の無い記載は正規化した名前でまとめる。同じ会社が番号あり・なしで別に数えられることがある',
      '1者応札率は、競争入札（一般・指名）のうち応札者数の記載がある契約に対する、応札が1者だった契約の割合（件数ベース）',
      '落札率は記載のある契約の単純平均。1者応札には特殊装備・備蓄基地など参入障壁が合理的なものを含み、率の高さは不適切さの判定ではない',
      'シート2024は元データの約14%の契約に方式が無く、生成時に落ちている',
    ],
    vendors: vendors.length,
  },
  vendors,
};
const file = path.resolve('public/data', 'vendors.json');
const text = JSON.stringify(out);
fs.writeFileSync(file, text);
fs.writeFileSync(`${file}.gz`, gzipSync(text, { level: 9 }));
console.log(JSON.stringify({ vendors: vendors.length, bytes: text.length, withRepeatSingle: vendors.filter(v => v.repeatSingleCount > 0).length }));
