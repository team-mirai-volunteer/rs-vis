/**
 * RS公開APIの支払先グループから、ブロックの「その他」行にまとめられた件数を抜き出す。
 *   npx tsx scripts/generate-others-counts.ts 2025
 * 出力: public/data/others-counts-{シート年度}.json(.gz)。件数の考え方は app/lib/others-count.ts。
 * 件数が一意に決まらないブロック・未取得の事業はキー自体を作らない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { isOthersRowName, othersCountFromGroup, type OthersCountsByPid } from '../app/lib/others-count';

type ApiGroup = { display_code: string; payment_count?: number | null;
  payments: Array<{ name: string; total_contract_amount: number | null; negative_total_contract_amount_count?: number }> };

const sheetYear = Number(process.argv[2]);
if (!Number.isInteger(sheetYear) || sheetYear < 2024) throw Error('Usage: generate-others-counts.ts <sheet year>');
const root = path.resolve(`data/rs-api/${sheetYear}`);
const projects: Array<{ id: string; project_number: string; fiscal_year: number }> = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));

const out: OthersCountsByPid = {};
let missing = 0, othersBlocks = 0, counted = 0;
for (const p of projects) {
  if (p.fiscal_year !== sheetYear || !/^\d+$/.test(p.project_number)) throw Error(`Invalid project ${p.id}`);
  const file = path.join(root, p.id, 'payment-groups.json');
  if (!fs.existsSync(file)) { missing++; continue; }
  const groups: ApiGroup[] = JSON.parse(fs.readFileSync(file, 'utf8')).data;
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
  if (Object.keys(blocks).length) out[String(Number(p.project_number))] = blocks;
}
const file = path.resolve('public/data', `others-counts-${sheetYear}.json`);
const text = JSON.stringify(out);
fs.writeFileSync(file, text);
fs.writeFileSync(`${file}.gz`, gzipSync(text, { level: 9 }));
console.log(JSON.stringify({ sheetYear, projects: projects.length, missing, othersBlocks, counted, written: Object.keys(out).length }));
