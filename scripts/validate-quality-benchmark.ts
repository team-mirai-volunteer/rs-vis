#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { resolve } from 'path';

type Baseline = {
  total: number | null;
  identify: number | null;
  purpose: number | null;
  budget: number | null;
  effective: number | null;
};

type BenchmarkProject = {
  pid: string;
  cohort: string;
  name: string;
  ministry: string;
  budgetAmount: number;
  challengeTags: string[];
  baseline: Baseline;
};

type Benchmark = {
  schemaVersion: number;
  benchmarkId: string;
  sourceYear: number;
  selectionPolicy: {
    cohortCount: number;
    projectsPerCohort: number;
  };
  projects: BenchmarkProject[];
};

type ScoreItem = {
  pid: string | number;
  name: string;
  ministry: string;
  budgetAmount: number;
  totalScore: number | null;
  axisIdentify: number | null;
  axisPurpose: number | null;
  axisBudget: number | null;
  axisEffective: number | null;
};

const root = resolve(__dirname, '..');
const benchmarkPath = resolve(root, 'tests', 'fixtures', 'quality-evaluation-benchmark-30.json');
const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as Benchmark;
const scoresPath = resolve(root, 'public', 'data', `project-quality-scores-${benchmark.sourceYear}.json`);
const scores = JSON.parse(readFileSync(scoresPath, 'utf8')) as ScoreItem[];
const scoreByPid = new Map(scores.map((item) => [String(item.pid), item]));

const errors: string[] = [];
const expectedCount =
  benchmark.selectionPolicy.cohortCount * benchmark.selectionPolicy.projectsPerCohort;

if (benchmark.projects.length !== expectedCount) {
  errors.push(`事業数: expected=${expectedCount}, actual=${benchmark.projects.length}`);
}

const pidSet = new Set<string>();
const cohortCounts = new Map<string, number>();

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.05;
}

for (const project of benchmark.projects) {
  if (pidSet.has(project.pid)) errors.push(`PID重複: ${project.pid}`);
  pidSet.add(project.pid);
  cohortCounts.set(project.cohort, (cohortCounts.get(project.cohort) ?? 0) + 1);

  const score = scoreByPid.get(project.pid);
  if (!score) {
    errors.push(`現行スコアに存在しないPID: ${project.pid}`);
    continue;
  }
  if (score.name !== project.name) errors.push(`事業名不一致 PID=${project.pid}`);
  if (score.ministry !== project.ministry) errors.push(`府省庁不一致 PID=${project.pid}`);
  if (score.budgetAmount !== project.budgetAmount) errors.push(`予算額不一致 PID=${project.pid}`);

  const comparisons: Array<[string, number | null, number | null]> = [
    ['total', score.totalScore, project.baseline.total],
    ['identify', score.axisIdentify, project.baseline.identify],
    ['purpose', score.axisPurpose, project.baseline.purpose],
    ['budget', score.axisBudget, project.baseline.budget],
    ['effective', score.axisEffective, project.baseline.effective],
  ];
  for (const [axis, current, baseline] of comparisons) {
    if (!sameNumber(current, baseline)) {
      errors.push(`ベースライン差分 PID=${project.pid} axis=${axis}: current=${current}, fixture=${baseline}`);
    }
  }
}

if (cohortCounts.size !== benchmark.selectionPolicy.cohortCount) {
  errors.push(
    `コホート数: expected=${benchmark.selectionPolicy.cohortCount}, actual=${cohortCounts.size}`,
  );
}
for (const [cohort, count] of cohortCounts) {
  if (count !== benchmark.selectionPolicy.projectsPerCohort) {
    errors.push(
      `コホート件数 ${cohort}: expected=${benchmark.selectionPolicy.projectsPerCohort}, actual=${count}`,
    );
  }
}

console.log(`${benchmark.benchmarkId}: ${benchmark.projects.length}事業`);
for (const [cohort, count] of [...cohortCounts].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${cohort}: ${count}`);
}

if (errors.length > 0) {
  console.error('\n検証エラー:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('\nOK: 件数、重複、コホート構成、現行ベースラインが一致しています。');
