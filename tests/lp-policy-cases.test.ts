import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDataJson } from '../app/lib/api/data-file';
import { contractCategory, type ContractMethodsByPid } from '../app/lib/contract-method';
import { SUPPORT_CASE, INVESTIGATION_CASE } from '../app/lp/policy-cases';
import type { VendorsFile } from '../types/vendors';

// 単なる見出しのスナップショットではなく、入口の事業・年度・企業が収録データと合うことを確認。
test('LP support model links to an existing project in the recorded fiscal year', () => {
  const scores = readDataJson<{ pid: string; name: string }[]>('project-quality-scores-2025.json', 'npm run score-quality-2025');
  assert.equal(scores.find(p => p.pid === SUPPORT_CASE.project.pid)?.name, SUPPORT_CASE.project.name);
  const url = new URL(SUPPORT_CASE.project.href, 'https://example.test');
  assert.equal(url.pathname, '/quality');
  assert.equal(url.searchParams.get('detail'), SUPPORT_CASE.project.pid);
  assert.equal(url.searchParams.get('fiscalYear'), '2024');
});

test('LP support model distinguishes funding, access and capacity without inventing unmet demand', () => {
  assert.deepEqual(SUPPORT_CASE.diagnoses.map(d => d.title), ['予算が足りない', '条件・手続きが壁になる', '実施体制が追いつかない']);
  assert.match(SUPPORT_CASE.visible, /執行率だけでは支援の過不足は分かりません/);
  assert.match(SUPPORT_CASE.unknown, /要件を満たす申請.*予算不足.*未確認/);
  assert.match(SUPPORT_CASE.diagnoses[0].evidence, /予算不足とそれ以外の理由に分け/);
  assert.match(SUPPORT_CASE.diagnoses[1].evidence, /未申請や取下げ/);
  assert.match(SUPPORT_CASE.diagnoses[2].evidence, /審査待ち日数.*職員配置.*設計・施工/);
  assert.match(SUPPORT_CASE.question, /要件を満たした.*予算不足で支援できなかった件数と必要額/);
  assert.match(SUPPORT_CASE.question, /増額と体制改善/);
  assert.match(SUPPORT_CASE.followUp, /同じ対象範囲.*未充足件数・審査待ち日数・改修完了件数/);
});

test('LP worked investigation uses the exact vendor/project and nonconsecutive years in RS', () => {
  const data = readDataJson<VendorsFile>('vendors.json', 'npm run generate-vendors');
  const vendor = data.vendors.find(v => v.key === INVESTIGATION_CASE.vendor.key)!;
  assert.equal(vendor.name, INVESTIGATION_CASE.vendor.name);
  const project = vendor.repeatSingle.find(p => p.pid === INVESTIGATION_CASE.project.pid)!;
  assert.equal(project.name, INVESTIGATION_CASE.project.name);
  assert.deepEqual(project.sheetYears, [...INVESTIGATION_CASE.sheetYears]);
  for (const year of INVESTIGATION_CASE.sheetYears) {
    const contracts = readDataJson<ContractMethodsByPid>(`contract-methods-${year}.json`, 'npm run generate-contract-methods');
    assert.ok(contracts[project.pid].some(row => row.cn === vendor.corporateNumber && row.ap === 1
      && ['open', 'selective'].includes(contractCategory(row.m))));
  }
  const url = new URL(INVESTIGATION_CASE.vendor.href, 'https://example.test');
  assert.equal(url.searchParams.get('vendor'), vendor.key);
  assert.equal(url.searchParams.get('signal'), 'repeatSingle');
  assert.match(INVESTIGATION_CASE.steps[0].body, /2023・2025年度.*暫定/);
  assert.doesNotMatch(INVESTIGATION_CASE.steps[0].body, /連続|毎年/);
});

test('LP investigation carries alternative explanations through verification and outcome measures', () => {
  assert.deepEqual(INVESTIGATION_CASE.steps.map(s => s.title), ['見つける', '別の説明も考える', '原資料で確かめる', '選択肢を比べる', '次の調達で測る']);
  assert.match(INVESTIGATION_CASE.intro, /調査モデル.*実施や効果.*まだ確認していません/);
  assert.match(INVESTIGATION_CASE.steps[1].body, /保守の継続性や専門性/);
  assert.match(INVESTIGATION_CASE.steps[1].body, /同じ契約が続いたかも未確定/);
  assert.match(INVESTIGATION_CASE.steps[2].body, /調達公告・仕様書・参加要件・契約結果/);
  assert.match(INVESTIGATION_CASE.steps[3].body, /分割発注・仕様の標準化・契約期間の変更/);
  assert.match(INVESTIGATION_CASE.steps[4].body, /応札者数.*価格.*品質.*事務負担/);
});

test('LP renders both policy models without replacing existing questions or title', () => {
  const page = readFileSync(new URL('../app/lp/page.tsx', import.meta.url), 'utf8');
  const components = readFileSync(new URL('../components/lp/PolicyCases.tsx', import.meta.url), 'utf8');
  assert.match(page, /const TITLE = '国の予算は、ここまで見える。'/);
  assert.match(page, /<PolicyCases \/>/);
  assert.match(page, /DIET_QUESTIONS/);
  assert.match(components, /aria-labelledby="policy-cases-heading"/);
});
