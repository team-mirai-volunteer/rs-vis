#!/usr/bin/env tsx

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

type Project = {
  pid: string;
  cohort: string;
  name: string;
  ministry: string;
};

type Evaluation = {
  pid: string;
  designClarity: number;
  evidenceReadiness: number;
  confidence: number;
  finding: string;
};

type Run = {
  model: string;
  results: Evaluation[];
};

const root = resolve(__dirname, '..');
const fixture = JSON.parse(
  readFileSync(resolve(root, 'tests/fixtures/quality-evaluation-benchmark-30.json'), 'utf8'),
) as { projects: Project[] };
const benchmark = JSON.parse(
  readFileSync(
    resolve(root, 'tests/benchmark-results/openrouter-model-optimization-2026-07-26.json'),
    'utf8',
  ),
) as { runs: Run[] };

const outputPath =
  process.argv[2] ??
  resolve(root, 'docs/exports/luna-policy-review-scores-2026-07-26.csv');
const luna = benchmark.runs.find((run) => run.model === 'openai/gpt-5.6-luna');
if (!luna) throw new Error('Luna run was not found.');

const resultByPid = new Map(luna.results.map((result) => [result.pid, result]));
const cohortLabels: Record<string, string> = {
  social_protection: '社会保障・直接給付',
  infrastructure_resilience: 'インフラ・レジリエンス',
  supply_capacity_innovation: '供給力・産業・研究開発',
  human_capital_knowledge_culture: '人的資本・知識・文化',
  security_external_environment_digital: '安全保障・外交・環境・デジタル',
  calibration_edge_cases: '境界・校正事例',
};

function statusOf(result: Evaluation, score: number) {
  if (result.evidenceReadiness <= 1) return 'EVIDENCE_MISSING';
  if (result.evidenceReadiness >= 3 && score >= 75) return 'READY_FOR_REVIEW';
  return 'NEEDS_ADDITIONAL_EVIDENCE';
}

const statusLabels: Record<string, string> = {
  EVIDENCE_MISSING: '証拠不足',
  NEEDS_ADDITIONAL_EVIDENCE: '追加証拠が必要',
  READY_FOR_REVIEW: 'レビュー可能',
};

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const header = [
  '事業ID',
  '事業名',
  '府省庁',
  '政策類型',
  '政策設計明瞭度（0〜4）',
  '証拠準備度（0〜4）',
  '政策設計点（0〜100）',
  '証拠準備点（0〜100）',
  'レビュー可能性スコア（0〜100）',
  '信頼度（0〜1）',
  '判定コード',
  '判定',
  '判断理由',
];

const rows = fixture.projects.map((project) => {
  const result = resultByPid.get(project.pid);
  if (!result) throw new Error(`Luna result missing: PID ${project.pid}`);

  const designScore = result.designClarity * 25;
  const evidenceScore = result.evidenceReadiness * 25;
  // 「政策価値」ではなく、入力記述からどこまでレビュー可能かを示す50:50の合成指標。
  const reviewReadinessScore = (designScore + evidenceScore) / 2;
  const status = statusOf(result, reviewReadinessScore);

  return [
    project.pid,
    project.name,
    project.ministry,
    cohortLabels[project.cohort] ?? project.cohort,
    result.designClarity,
    result.evidenceReadiness,
    designScore,
    evidenceScore,
    reviewReadinessScore,
    result.confidence.toFixed(2),
    status,
    statusLabels[status],
    result.finding,
  ];
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
  'utf8',
);

console.log(`Wrote ${rows.length} Luna scores to ${outputPath}`);
