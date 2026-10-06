/**
 * 独立行政法人のセグメントシート（RSシステム sheet_type=SS）を、運営費交付金などのレビューシート事業に結びつける。
 *   node scripts/fetch-rs-api.mjs 2026 --sheet SS   # data/rs-api-ss/{年}/ に一覧・詳細・支出先を取得
 *   npx tsx scripts/generate-agency-segments.ts
 * 出力: public/data/agency-segments.json(.gz)。金額は府省の記載どおり（検証はしていない）。
 * 事業への対応は、詳細の related_projects（ss-link-base）を優先し、無いものは同じシート年度のレビューシートで
 * 「法人名」と「運営費交付金」を含む事業名が1件だけのときに限って結びつける（linkBasis: 'name'）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AgencySegment, AgencySegmentsFile } from '../types/agency-segments';
import { paymentGroups } from '../app/lib/payment-groups';

const SHEET_YEARS = [2024, 2025, 2026];
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== 'ー' && v.trim() !== '-' ? v.trim() : null);
const readData = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).data : null);

const segments: AgencySegment[] = [];
const missing: string[] = [];
for (const sheetYear of SHEET_YEARS) {
  const root = path.resolve(`data/rs-api-ss/${sheetYear}`);
  const listFile = path.join(root, 'projects.json');
  if (!fs.existsSync(listFile)) { console.warn(`skip ${sheetYear}: ${listFile} が無い`); continue; }
  const rsFile = path.resolve(`data/rs-api/${sheetYear}/projects.json`);
  const rsProjects: Raw[] = fs.existsSync(rsFile) ? JSON.parse(fs.readFileSync(rsFile, 'utf8')) : [];
  for (const p of JSON.parse(fs.readFileSync(listFile, 'utf8')) as Raw[]) {
    const detail: Raw | null = readData(path.join(root, p.id, 'detail.json'));
    if (!detail) { missing.push(`${sheetYear}/${p.project_number}`); continue; }
    const agency = text(detail.independent_administrative_agency?.name) ?? '';
    let pids = (detail.related_projects ?? []).filter((r: Raw) => r.relation_type === 'ss-link-base')
      .map((r: Raw) => /^(\d+):/.exec(r.name ?? '')?.[1]).filter(Boolean).map(Number) as number[];
    let linkBasis: AgencySegment['linkBasis'] = pids.length ? 'sheet' : null;
    if (!pids.length && agency) {
      const hits = rsProjects.filter(r => typeof r.name === 'string' && r.name.includes(agency) && r.name.includes('運営費交付金'));
      if (hits.length === 1) { pids = [Number(hits[0].project_number)]; linkBasis = 'name'; }
    }
    const s = detail.segment_expenditure_and_execution ?? {};
    const overview = text(p.overview);
    segments.push({
      id: p.id, lineage: p.lineage_id ?? p.id, sheetYear,
      name: text(p.name) ?? '', agency, ministry: text(p.ministry_name) ?? '',
      concept: text(detail.segment_unit_concept),
      overview: overview && overview.length > 300 ? `${overview.slice(0, 300)}…` : overview,
      execution: p.negative_previous_year_execution_amount_count ? null : num(p.previous_year_execution_amount),
      revenueBudget: num(s.revenue_initial_budget_amount),
      expenditureBudget: num(s.expenditure_budget_amount),
      pids: [...new Set(pids)], linkBasis,
      groups: paymentGroups(readData(path.join(root, p.id, 'payment-groups.json')) ?? [], agency),
    });
  }
}
segments.sort((a, b) => b.sheetYear - a.sheetYear || (b.execution ?? 0) - (a.execution ?? 0));
const byPid: Record<string, string[]> = {};
for (const s of segments) for (const pid of s.pids) (byPid[String(pid)] ??= []).push(s.id);

const out: AgencySegmentsFile = {
  metadata: {
    generatedAt: new Date().toISOString(), sheetYears: SHEET_YEARS, source: 'RSシステム セグメントシート（RS公開API sheet_type=SS）',
    notes: [
      'シート年度 N の前年度の執行額・支出先は年度 N−1 の実績。金額は府省の記載どおり。',
      '事業への対応は、シートに記載された関連レビューシートを優先し、無いものは法人名と「運営費交付金」を含む事業名が1件に絞れるときだけ結びつけた。',
      '支出先のグループ間のつながりはシートに記載が無いため、合計すると同じお金を重ねて数えることがある。',
    ],
  },
  segments,
  byPid,
};
const file = path.resolve('public/data/agency-segments.json');
const json = JSON.stringify(out);
fs.writeFileSync(file, json);
fs.writeFileSync(`${file}.gz`, gzipSync(json, { level: 9 }));
const linked = segments.filter(s => s.pids.length);
console.log(JSON.stringify({
  segments: segments.length, agencies: new Set(segments.map(s => s.agency)).size, linkedBySheet: linked.filter(s => s.linkBasis === 'sheet').length,
  linkedByName: linked.filter(s => s.linkBasis === 'name').length, unlinked: segments.length - linked.length, missingDetail: missing, sizeKB: Math.round(json.length / 1024),
}));
