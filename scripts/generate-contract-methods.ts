/**
 * 支出先ごとの契約方式・応札者数・落札率を抜き出す。公式CSV（5-1）があればそれを、無い年度は RS公開APIの取得データを使う（scripts/rs-sheet-groups.ts）。
 *   node scripts/fetch-rs-api.mjs 2026   # CSV の無い年度だけ API を取得
 *   npx tsx scripts/generate-contract-methods.ts 2025
 * 出力: public/data/contract-methods-{シート年度}.json(.gz)。
 * 契約概要は支出行データ（project-quality-recipients）に既にあるので持たない（金額で突き合わせる）。
 * is_others（「年金受給者」「その他の市区町村」など相手を特定しない支払先）も、給付・補助など契約以外と分かるので含める。
 * 未取得の事業はキー自体を作らない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { apiContractMethod, type ContractMethodEntry, type ContractMethodsByPid } from '../app/lib/contract-method';
import { loadSheetGroups } from './rs-sheet-groups';

const sheetYear = Number(process.argv[2]);
if (!Number.isInteger(sheetYear) || sheetYear < 2024) throw Error('Usage: generate-contract-methods.ts <sheet year>');
const { source, byPid, missing } = loadSheetGroups(sheetYear);

const out: ContractMethodsByPid = {};
let contracts = 0, withoutMethod = 0, droppedBidRate = 0;
for (const [pid, groups] of byPid) {
  const entries: ContractMethodEntry[] = [];
  for (const g of groups) for (const pay of g.payments) {
    for (const c of pay.contracts) {
      contracts++;
      const method = apiContractMethod(c);
      if (!method) { withoutMethod++; continue; }
      if (c.bid_rate !== null && c.bid_rate > 100) droppedBidRate++;
      entries.push({ b: g.display_code, n: pay.name, cn: pay.corporate_number ?? '', a: c.amount, ...method });
    }
  }
  out[pid] = entries;
}
const file = path.resolve('public/data', `contract-methods-${sheetYear}.json`);
const text = JSON.stringify(out);
fs.writeFileSync(file, text);
fs.writeFileSync(`${file}.gz`, gzipSync(text, { level: 9 }));
console.log(JSON.stringify({ sheetYear, source, written: Object.keys(out).length, missing, contracts, withoutMethod, droppedBidRate }));
