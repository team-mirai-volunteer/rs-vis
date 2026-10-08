/**
 * ブロックの「その他」行にまとめられた件数を抜き出す（支出先の数 − 名前のある行）。公式CSV（5-1）があればそれを、無い年度は RS公開APIを使う。
 *   npx tsx scripts/generate-others-counts.ts 2025
 * 出力: public/data/others-counts-{シート年度}.json(.gz)。件数の考え方は app/lib/others-count.ts。
 * 件数が一意に決まらないブロック・未取得の事業はキー自体を作らない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { isOthersRowName, othersCountFromGroup, type OthersCountsByPid } from '../app/lib/others-count';
import { loadSheetGroups } from './rs-sheet-groups';

const sheetYear = Number(process.argv[2]);
if (!Number.isInteger(sheetYear) || sheetYear < 2024) throw Error('Usage: generate-others-counts.ts <sheet year>');
const { source, byPid, missing } = loadSheetGroups(sheetYear);

const out: OthersCountsByPid = {};
let othersBlocks = 0, counted = 0;
for (const [pid, groups] of byPid) {
  const blocks: OthersCountsByPid[string] = {};
  for (const g of groups) {
    if (!g.payments.some(pay => isOthersRowName(pay.name))) continue;
    othersBlocks++;
    // 非公表（負の金額件数あり）の金額は突き合わせに使わない
    const count = othersCountFromGroup({ payment_count: g.payment_count, payments: g.payments.map(pay => ({ name: pay.name,
      total_contract_amount: pay.negative_total_contract_amount_count ? null : pay.total_contract_amount })) });
    if (!count) continue;
    counted++;
    blocks[g.display_code] = count;
  }
  if (Object.keys(blocks).length) out[pid] = blocks;
}
const file = path.resolve('public/data', `others-counts-${sheetYear}.json`);
const text = JSON.stringify(out);
fs.writeFileSync(file, text);
fs.writeFileSync(`${file}.gz`, gzipSync(text, { level: 9 }));
console.log(JSON.stringify({ sheetYear, source, projects: byPid.size, missing, othersBlocks, counted, written: Object.keys(out).length }));
