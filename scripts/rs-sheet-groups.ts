/**
 * RSシートの支出先（5-1）を、ブロック → 支払先 → 契約 の形で読む。公式CSV（data/year_{年}/5-1_RS_{年}_支出先_支出情報.csv）が
 * あればそれを正とし、無い年度（まだCSVが公開されていない 2026 シートなど）だけ RS公開APIの取得データ（data/rs-api/{年}/）を使う。
 * 契約方式・応札者数・落札率・所在地・法人種別・支出先の数は、CSVにもAPIにも同じ内容がある。
 */
import fs from 'node:fs';
import path from 'node:path';
import { readShiftJISCSV } from './csv-reader';
import { contractMethodFromCsvLabel } from '../app/lib/contract-method';

export interface SheetContract {
  overview: string | null;
  amount: number | null;
  /** ContractMethodCode（CSVは文言から変換済み） */
  contract_method: string | null;
  contract_method_description: string | null;
  number_of_applicants: number | null;
  bid_rate: number | null;
}
export interface SheetPayment {
  name: string;
  is_others: boolean;
  corporate_number: string | null;
  corporate_address: string | null;
  corporate_kind: string | null;
  total_contract_amount: number | null;
  /** API で非公表（負の金額）が含まれるとき。CSVでは常に 0 */
  negative_total_contract_amount_count?: number;
  contracts: SheetContract[];
}
export interface SheetGroup {
  display_code: string;
  name: string;
  /** 府省庁が記載したブロックの支出先の数 */
  payment_count: number | null;
  payments: SheetPayment[];
}
export interface SheetGroups {
  source: 'csv' | 'api';
  /** 予算事業ID（先頭ゼロなし）→ ブロック */
  byPid: Map<string, SheetGroup[]>;
  /** API で支払先を取得できていない事業の数（CSV では 0） */
  missing: number;
}

const num = (s: string | undefined) => {
  const t = (s ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const text = (s: string | undefined) => (s ?? '').trim() || null;

export const csvPath = (sheetYear: number) => path.resolve(`data/year_${sheetYear}/5-1_RS_${sheetYear}_支出先_支出情報.csv`);

function fromCsv(sheetYear: number): SheetGroups {
  const byPid = new Map<string, SheetGroup[]>();
  const groupOf = new Map<string, SheetGroup>();
  const paymentOf = new Map<string, SheetPayment>();
  for (const row of readShiftJISCSV(csvPath(sheetYear))) {
    const pidNum = parseInt(row['予算事業ID'] ?? '', 10);
    const blockId = (row['支出先ブロック番号'] ?? '').trim();
    if (Number.isNaN(pidNum) || !blockId) continue;
    const pid = String(pidNum);
    const gKey = `${pid}:${blockId}`;
    let group = groupOf.get(gKey);
    if (!group) {
      group = { display_code: blockId, name: '', payment_count: null, payments: [] };
      groupOf.set(gKey, group);
      byPid.set(pid, [...(byPid.get(pid) ?? []), group]);
    }
    const recipient = (row['支出先名'] ?? '').trim();
    // ブロック行: ブロック名・支出先の数だけを持つ
    if (!recipient) {
      if (!group.name) group.name = (row['支出先ブロック名'] ?? '').trim();
      if (group.payment_count === null) group.payment_count = num(row['支出先の数']);
      continue;
    }
    const cn = text(row['法人番号']);
    const pKey = `${gKey}:${recipient}|${cn ?? ''}`;
    let payment = paymentOf.get(pKey);
    if (!payment) {
      payment = { name: recipient, is_others: false, corporate_number: cn, corporate_address: null, corporate_kind: null, total_contract_amount: null, contracts: [] };
      paymentOf.set(pKey, payment);
      group.payments.push(payment);
    }
    if ((row['その他支出先'] ?? '').trim().toUpperCase() === 'TRUE') payment.is_others = true;
    payment.corporate_address ??= text(row['所在地']);
    payment.corporate_kind ??= text(row['法人種別']);
    // 支出先行（支出先の合計支出額）と契約行（契約概要・金額・契約方式）は別の行
    const total = num(row['支出先の合計支出額']);
    if (total !== null) payment.total_contract_amount = Math.max(payment.total_contract_amount ?? 0, total);
    const amount = num(row['金額']);
    const label = (row['契約方式等'] ?? '').trim();
    if (amount !== null || label || (row['契約概要'] ?? '').trim()) {
      payment.contracts.push({
        overview: text(row['契約概要']), amount,
        contract_method: label ? contractMethodFromCsvLabel(label) : null,
        contract_method_description: text(row['具体的な契約方式等']),
        number_of_applicants: num(row['入札者数']), bid_rate: num(row['落札率']),
      });
    }
  }
  return { source: 'csv', byPid, missing: 0 };
}

function fromApi(sheetYear: number): SheetGroups {
  const root = path.resolve(`data/rs-api/${sheetYear}`);
  const projects: Array<{ id: string; project_number: string; fiscal_year: number }> = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
  const byPid = new Map<string, SheetGroup[]>();
  let missing = 0;
  for (const p of projects) {
    if (p.fiscal_year !== sheetYear || !/^\d+$/.test(p.project_number)) throw Error(`Invalid project ${p.id}`);
    const file = path.join(root, p.id, 'payment-groups.json');
    if (!fs.existsSync(file)) { missing++; continue; }
    byPid.set(String(Number(p.project_number)), JSON.parse(fs.readFileSync(file, 'utf8')).data as SheetGroup[]);
  }
  return { source: 'api', byPid, missing };
}

export function loadSheetGroups(sheetYear: number): SheetGroups {
  return fs.existsSync(csvPath(sheetYear)) ? fromCsv(sheetYear) : fromApi(sheetYear);
}
