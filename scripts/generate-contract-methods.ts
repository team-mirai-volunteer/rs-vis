/**
 * RS公開APIの支払先グループから、支出先ごとの契約方式・応札者数・落札率を抜き出す。
 *   node scripts/fetch-rs-api.mjs 2025   # data/rs-api/2025/ に取得（未取得分だけ）
 *   npx tsx scripts/generate-contract-methods.ts 2025
 * 出力: public/data/contract-methods-{シート年度}.json(.gz)。公式CSV由来の出力は変更しない。
 * 契約概要は支出行データ（project-quality-recipients）に既にあるので持たない（金額で突き合わせる）。
 * is_others（「年金受給者」「その他の市区町村」など相手を特定しない支払先）も、給付・補助など契約以外と分かるので含める。
 * 未取得の事業はキー自体を作らない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { isContractMethodCode, type ContractMethodEntry, type ContractMethodsByPid } from '../app/lib/contract-method';

type ApiContract = { is_others: boolean; amount: number | null; contract_method: string | null; contract_method_description: string | null;
  number_of_applicants: number | null; bid_rate: number | null; overview?: string | null };
type ApiGroup = { display_code: string; payments: Array<{ name: string; is_others: boolean; corporate_number: string | null; contracts: ApiContract[] }> };

const sheetYear = Number(process.argv[2]);
if (!Number.isInteger(sheetYear) || sheetYear < 2024) throw Error('Usage: generate-contract-methods.ts <sheet year>');
const root = path.resolve(`data/rs-api/${sheetYear}`);
const projects: Array<{ id: string; project_number: string; fiscal_year: number }> = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));

const out: ContractMethodsByPid = {};
let missing = 0, contracts = 0, withoutMethod = 0, droppedBidRate = 0;
for (const p of projects) {
  if (p.fiscal_year !== sheetYear || !/^\d+$/.test(p.project_number)) throw Error(`Invalid project ${p.id}`);
  const file = path.join(root, p.id, 'payment-groups.json');
  if (!fs.existsSync(file)) { missing++; continue; }
  const groups: ApiGroup[] = JSON.parse(fs.readFileSync(file, 'utf8')).data;
  const entries: ContractMethodEntry[] = [];
  for (const g of groups) for (const pay of g.payments) {
    for (const c of pay.contracts) {
      contracts++;
      if (!isContractMethodCode(c.contract_method)) { withoutMethod++; continue; }
      const entry: ContractMethodEntry = { b: g.display_code, n: pay.name, cn: pay.corporate_number ?? '', a: c.amount, m: c.contract_method };
      const text = c.contract_method_description?.trim();
      // 「-」「－」「その他」などの埋め草は補足として意味を持たないので落とす
      if (text && !/^[-－ー‐―—–・\s]*$/.test(text) && text !== 'その他') entry.mt = text;
      if (Number.isInteger(c.number_of_applicants) && c.number_of_applicants! >= 0) entry.ap = c.number_of_applicants!;
      // 落札率は 0〜100%。それを超える値（999 など）は誤記載とみなして出さない
      if (c.bid_rate !== null && Number.isFinite(c.bid_rate)) {
        if (c.bid_rate > 0 && c.bid_rate <= 100) entry.br = c.bid_rate;
        else if (c.bid_rate > 100) droppedBidRate++;
      }
      entries.push(entry);
    }
  }
  out[String(Number(p.project_number))] = entries;
}
const file = path.resolve('public/data', `contract-methods-${sheetYear}.json`);
const text = JSON.stringify(out);
fs.writeFileSync(file, text);
fs.writeFileSync(`${file}.gz`, gzipSync(text, { level: 9 }));
console.log(JSON.stringify({ sheetYear, projects: projects.length, written: Object.keys(out).length, missing, contracts, withoutMethod, droppedBidRate }));
