/**
 * 基金シート（RSシステムの sheet_type=KS）を、基金（lineage_id）ごとに年度をまたいでまとめる。
 *   node scripts/fetch-rs-api.mjs 2025 --sheet KS   # data/rs-api-ks/{年}/ に一覧・詳細・支払先を取得
 *   npx tsx scripts/generate-funds.ts
 * 出力: public/data/funds.json(.gz)。金額・率は府省の記載どおり（検証はしていない）。
 * 造成元の事業は、詳細の related_projects（ks-link-base）と造成の経緯の related_review_sheet_id から予算事業IDに引き当てる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Fund, FundComposition, FundsFile, FundYear } from '../types/funds';

const SHEET_YEARS = [2024, 2025, 2026];
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== 'ー' && v.trim() !== '-' ? v.trim() : null);

/** RSシートの id → 予算事業ID（先頭ゼロなし）。造成の経緯が指すレビューシートの引き当てに使う */
const pidByRsId = new Map<string, string>();
/** 予算事業ID → 事業名と、その事業が載っている最新のシート年度（終わった事業は古い年度にしか無い） */
const projectByPid = new Map<string, { name: string; sheetYear: number }>();
for (const y of SHEET_YEARS) {
  const file = path.resolve(`data/rs-api/${y}/projects.json`);
  if (!fs.existsSync(file)) continue;
  for (const p of JSON.parse(fs.readFileSync(file, 'utf8')) as Raw[]) {
    const pid = String(Number(p.project_number));
    pidByRsId.set(p.id, pid);
    projectByPid.set(pid, { name: p.name, sheetYear: y });
  }
}

type Acc = { latest: Raw; detail: Raw | null; years: FundYear[]; related: Set<string>; compositions: Map<string, FundComposition> };
const byKey = new Map<string, Acc>();
for (const sheetYear of SHEET_YEARS) {
  const root = path.resolve(`data/rs-api-ks/${sheetYear}`);
  const listFile = path.join(root, 'projects.json');
  if (!fs.existsSync(listFile)) { console.warn(`skip ${sheetYear}: ${listFile} が無い`); continue; }
  for (const p of JSON.parse(fs.readFileSync(listFile, 'utf8')) as Raw[]) {
    const detailFile = path.join(root, p.id, 'detail.json');
    const detail: Raw | null = fs.existsSync(detailFile) ? JSON.parse(fs.readFileSync(detailFile, 'utf8')).data : null;
    const ie: Raw = detail?.fund_additional_income_and_expenditure ?? {};
    const key = p.lineage_id ?? p.id;
    const acc: Acc = byKey.get(key) ?? { latest: p, detail, years: [], related: new Set<string>(), compositions: new Map() };
    // 新しいシートの記載（名称・終了予定・点検など）を正にする
    if (sheetYear >= (acc.latest.fiscal_year ?? 0)) { acc.latest = p; acc.detail = detail ?? acc.detail; }
    acc.years.push({
      sheetYear,
      balance: num(p.beginning_of_the_fund_balance),
      nationalBalance: num(ie.national_equivalent_of_the_balance),
      granted: num(ie.granted_amount_by_the_country),
      income: p.negative_previous_year_total_income_count ? null : num(p.previous_year_total_income),
      expense: p.negative_previous_year_total_expense_count ? null : num(p.previous_year_total_expense),
      businessExpense: num(ie.business_expense),
      adminExpense: num(p.previous_year_administrative_expense),
      adminRate: num(p.previous_year_administrative_expense_rate),
      returned: num(p.previous_year_amount_returned_to_the_national_treasury),
      divergence: num(p.previous_year_divergence_rate),
      ownership: num(p.ownership_ratio),
      projectId: p.id,
    });
    for (const r of detail?.related_projects ?? []) {
      const m = /^(\d+):/.exec(r.name ?? '');
      if (m && (r.relation_type === 'ks-link-base' || r.relation_type === 'others-base')) acc.related.add(String(Number(m[1])));
    }
    for (const c of detail?.fund_additional_attributes?.composition_backgrounds ?? []) {
      const pid = c.related_review_sheet_id ? pidByRsId.get(c.related_review_sheet_id) : undefined;
      const comp: FundComposition = { fiscalYear: num(c.fiscal_year_of_budgetary_provision) ?? num(c.fiscal_year_of_creation), budget: text(c.budget),
        amount: num(c.amount_of_state_expenditure), ...(pid ? { pid } : {}) };
      if (pid) acc.related.add(pid);
      acc.compositions.set(`${comp.fiscalYear}|${comp.budget}|${comp.amount}`, comp);
    }
    byKey.set(key, acc);
  }
}

const funds: Fund[] = [];
for (const [key, acc] of byKey) {
  const p = acc.latest;
  const a: Raw = acc.detail?.fund_additional_attributes ?? {};
  const ie: Raw = acc.detail?.inspection_evaluation ?? {};
  const low: Raw = ie.low_used_fund_investigation ?? {};
  const basis: Raw = ie.ownership_ratio?.basis ?? {};
  const ownershipBasis = [text(basis.contents_of_held_fund_amount) && `基金残高: ${text(basis.contents_of_held_fund_amount)}`,
    text(basis.contents_of_fund_project_costs) && `必要額: ${text(basis.contents_of_fund_project_costs)}`].filter(Boolean).join('\n') || null;
  const inspectionNote = [text(low.reasons_for_leaving) && `残している理由: ${text(low.reasons_for_leaving)}`,
    text(low.results_of_investigations) && `点検の結果: ${text(low.results_of_investigations)}`].filter(Boolean).join('\n') || null;
  funds.push({
    key,
    name: text(a.fund_business_name) ?? p.name,
    ministry: p.ministry_name ?? '',
    owner: text(p.fund_owner) ?? text(a.fund_owner) ?? '',
    ownerForm: text(a.corporate_form),
    sheetNumber: num(p.fund_sheet_number),
    operationForms: p.operation_forms ?? [],
    businessForms: p.business_forms ?? [],
    createdYear: num(p.composition_backgrounds_fiscal_year_of_creation),
    endDate: text(p.scheduled_end_end_date),
    newApplicationEndDate: text(p.scheduled_end_end_date_of_new_application_receiving),
    necessity: text(a.necessity_reasons),
    ownershipBasis,
    inspection: {
      noRecentResult: !!low.has_no_result_recent, ceasedOperations: !!low.has_ceased_operations, lostPurpose: !!low.has_fund_that_lost_purpose,
      ownershipFarAboveOne: !!low.has_exceed_one_significantly, unlikelyToBeUsed: !!low.has_deemed_unlikely_to_be_used,
    },
    inspectionNote,
    overviewUrl: text(acc.detail?.overview_url),
    compositions: [...acc.compositions.values()].sort((x, y) => (x.fiscalYear ?? 0) - (y.fiscalYear ?? 0)),
    relatedPids: [...acc.related].sort((x, y) => Number(x) - Number(y)),
    relatedProjects: [...acc.related].sort((x, y) => Number(x) - Number(y)).flatMap(pid => {
      const info = projectByPid.get(pid);
      return info ? [{ pid, name: info.name, sheetYear: info.sheetYear }] : [];
    }),
    years: acc.years.sort((x, y) => x.sheetYear - y.sheetYear),
  });
}
funds.sort((x, y) => (y.years.at(-1)?.balance ?? 0) - (x.years.at(-1)?.balance ?? 0));

const out: FundsFile = {
  metadata: {
    generatedAt: new Date().toISOString(), sheetYears: SHEET_YEARS, source: 'RSシステム 基金シート（RS公開API sheet_type=KS）',
    notes: ['金額・率は府省の記載どおり。シート年度 N の「前年度」は年度 N−1 の実績、残高は年度 N−1 の末の値。', '造成元の事業は基金シートの関連レビューシート・造成の経緯から引き当てた。'],
  },
  funds,
};
const file = path.resolve('public/data/funds.json');
const json = JSON.stringify(out);
fs.writeFileSync(file, json);
fs.writeFileSync(`${file}.gz`, gzipSync(json, { level: 9 }));
const latest = funds.map(f => f.years.at(-1)!);
console.log(JSON.stringify({ funds: funds.length, withRelatedPid: funds.filter(f => f.relatedPids.length).length,
  flagged: funds.filter(f => Object.values(f.inspection).some(Boolean)).length, latestBalance: latest.reduce((s, y) => s + (y.balance ?? 0), 0),
  sizeKB: Math.round(json.length / 1024) }));
