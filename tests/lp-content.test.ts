import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_EVALUATION_NATURE } from '../app/lib/ai-evaluation-disclosure';
import { readDataJson } from '../app/lib/api/data-file';
import type { RecipientRowsByPid } from '../app/lib/api/quality-recipients-loader';
import { contractCategory, type ContractMethodsByPid } from '../app/lib/contract-method';
import { AUDIT_MATCH_DISCLOSURE, AUDIT_PROJECT_COUNTS } from '../app/lp/audit-summary';
import { DIET_QUESTIONS, DIET_SETS, HERO_STATS, INSIGHTS, PERSONAS } from '../app/lp/insights';
import auditMatches from '../scripts/data/audit-report-matches.json';
import executionMatches from '../scripts/data/budget-execution-audit-matches.json';

test('LP audit coverage deduplicates PIDs and agrees with the generated data', () => {
  const audit = readDataJson<{ byPid: Record<string, unknown> }>('audit-report.json', 'npm run generate-audit-report');
  const execution = readDataJson<{ byPid: Record<string, unknown> }>('budget-execution-audit.json', 'npm run generate-budget-execution-audit');
  const a = Object.keys(audit.byPid);
  const b = Object.keys(execution.byPid);
  assert.deepEqual(AUDIT_PROJECT_COUNTS, {
    auditReport: a.length,
    budgetExecution: b.length,
    both: a.filter(pid => b.includes(pid)).length,
    either: new Set([...a, ...b]).size,
  });
  assert.deepEqual(AUDIT_PROJECT_COUNTS, { auditReport: 41, budgetExecution: 60, both: 10, either: 91 });
  assert.equal(INSIGHTS.find(item => item.id === 'audit')?.figure, '91事業');
});

test('LP audit provenance comes from the stored review status', () => {
  assert.ok(AUDIT_MATCH_DISCLOSURE.includes(auditMatches.reviewedBy));
  assert.ok(AUDIT_MATCH_DISCLOSURE.includes(executionMatches.reviewedBy));
  assert.match(AUDIT_MATCH_DISCLOSURE, /人による確認は未実施/);
  for (const caveat of [INSIGHTS.find(item => item.id === 'audit')!.caveat, DIET_QUESTIONS.find(q => q.theme === '検査結果の反映')!.caveat]) {
    assert.ok(caveat.includes(AUDIT_MATCH_DISCLOSURE));
    assert.doesNotMatch(caveat, /人手確認を加えた/);
  }
});

test('LP labels the 99,292 recipient entries as a non-deduplicated count', () => {
  const scores = readDataJson<{ recipientCount: number }[]>('project-quality-scores-2025.json', 'npm run score-quality-2025');
  const entries = scores.reduce((sum, project) => sum + project.recipientCount, 0);
  assert.equal(entries, 99_292);
  const stat = HERO_STATS.find(stat => stat.label.includes('延べ支出先記載'))!;
  assert.equal(stat.value, (entries / 10_000).toFixed(1));
  assert.equal(stat.unit, '万件');
});

test('LP single-bid percentage uses the RS contracts with a recorded applicant count', () => {
  const contracts = readDataJson<ContractMethodsByPid>('contract-methods-2025.json', 'npm run generate-contract-methods');
  const competitive = Object.values(contracts).flat().filter(row => ['open', 'selective'].includes(contractCategory(row.m)));
  const recorded = competitive.filter(row => row.ap !== undefined);
  assert.equal(competitive.length, 17_148);
  assert.equal(recorded.length, 16_948);
  // 0と未記載を取り違えて、母数を無言で変えない。
  assert.equal(recorded.filter(row => row.ap === 0).length, 96);
  const single = recorded.filter(row => row.ap === 1);
  assert.equal(single.length, 8_134);
  assert.equal((single.length / recorded.length * 100).toFixed(1), '48.0');
});

test('LP secretariat figure is reproducible for the named company and stated fields', () => {
  const recipients = readDataJson<RecipientRowsByPid>('project-quality-recipients-2025.json', 'npm run score-quality-2025');
  const rows = Object.entries(recipients).flatMap(([pid, rows]) => rows
    .filter(row => row.r && row.d === 0 && (row.a2 ?? 0) > 0 && row.n === '株式会社博報堂'
      && /事務局|補助事業に関する事務|執行事務|事務費/.test(`${row.cc} ${row.role}`))
    .map(row => ({ pid, row })));
  assert.equal(rows.length, 14);
  assert.equal(new Set(rows.map(({ pid }) => pid)).size, 9);
  assert.ok(rows.every(({ row }) => row.cn === '8010401024011'));
  assert.equal(rows.reduce((sum, { row }) => sum + row.a2!, 0), 302_685_876_076);
  const broker = INSIGHTS.find(item => item.id === 'secretariat')!;
  assert.equal(broker.figure, '3,027億円');
  assert.match(broker.figureNote, /株式会社博報堂/);
  assert.match(broker.facts[0], /契約概要または役割/);
});

test('LP uses the shared AI disclosure and does not claim blanket pension exclusion or budget coverage', () => {
  const page = readFileSync(new URL('../app/lp/page.tsx', import.meta.url), 'utf8');
  const scoreMeta = readFileSync(new URL('../client/components/quality/score-meta.tsx', import.meta.url), 'utf8');
  assert.match(page, /\{AI_EVALUATION_NATURE\}/);
  assert.match(scoreMeta, /export \{ AI_EVALUATION_TITLE, AI_EVALUATION_NATURE \} from '@\/app\/lib\/ai-evaluation-disclosure'/);
  assert.match(AI_EVALUATION_NATURE, /政策上の判断/);
  assert.match(AI_EVALUATION_NATURE, /人によるレビューも経ていません/);
  assert.doesNotMatch(page, /対象は国の予算の約27%|年金給付・財政投融資はレビューの対象外/);
  assert.match(page, /年金給付を含む事業もレビュー対象/);
});

test('LP keeps the verified scope and avoids causal conclusions from descriptive figures', () => {
  const bid = INSIGHTS.find(item => item.id === 'single-bid')!;
  assert.match(bid.title, /RSに記載/);
  assert.match(bid.figureNote, /応札者数の記載がある16,948件/);
  const broker = INSIGHTS.find(item => item.id === 'secretariat')!;
  assert.match(broker.title, /補助金本体を含む/);
  assert.match(broker.facts.slice(0, 2).join(''), /手数料ではない/);
  assert.doesNotMatch(INSIGHTS.find(item => item.id === 'low-execution')!.unknown.join(''), /不用なら予算が過大/);
  const childcare = DIET_QUESTIONS.find(q => q.theme === '少子化')!;
  assert.match(childcare.techProposal, /比較対象/);
  assert.match(childcare.techProposal, /他の要因/);
  assert.doesNotMatch(childcare.techProposal, /効果を翌年には確かめられ/);
});

test('LP retains all fifteen parliamentary questions and twelve scripts', () => {
  assert.deepEqual(DIET_QUESTIONS.map(q => q.theme), [
    '記載の穴', '1者応札', '基金', '補正予算の執行見込み', '防衛費の契約検証', '検査結果の反映', '再委託',
    '成果指標', '補助金事務局', '企画競争・公募', '賃上げ税制', '研究開発税制', '少子化', '研究力', 'エネルギー',
  ]);
  assert.equal(DIET_QUESTIONS.filter(q => q.script).length, 12);
  for (const q of DIET_QUESTIONS) {
    assert.ok(q.opening && q.acknowledge && q.known.length && q.official.length && q.response && q.minister && q.promise && q.closing && q.techProposal && q.verify);
  }
  for (const set of DIET_SETS) {
    for (const theme of set.themes) assert.ok(DIET_QUESTIONS.some(q => q.theme === theme));
  }
  assert.ok(PERSONAS.some(persona => persona.title.includes('議員')));
});
