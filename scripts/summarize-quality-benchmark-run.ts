#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { resolve } from 'path';

type FixtureProject = {
  pid: string;
  name: string;
  cohort: string;
  baseline: {
    total: number;
    effective: number | null;
  };
};

type RunResult = {
  pid: string;
  designClarity: number;
  evidenceReadiness: number;
  confidence: number;
  finding: string;
};

type Fixture = {
  benchmarkId: string;
  projects: FixtureProject[];
};

type Run = {
  runId: string;
  benchmarkId: string;
  results: RunResult[];
};

const root = resolve(__dirname, '..');
const fixture = JSON.parse(
  readFileSync(resolve(root, 'tests/fixtures/quality-evaluation-benchmark-30.json'), 'utf8'),
) as Fixture;
const runPath =
  process.argv[2] ??
  resolve(
    root,
    'tests/benchmark-results/quality-evaluation-2025-v1.single-no-web.run-001.json',
  );
const run = JSON.parse(readFileSync(resolve(runPath), 'utf8')) as Run;

if (run.benchmarkId !== fixture.benchmarkId) {
  throw new Error(`benchmarkId不一致: fixture=${fixture.benchmarkId}, run=${run.benchmarkId}`);
}
if (run.results.length !== fixture.projects.length) {
  throw new Error(`結果件数不一致: fixture=${fixture.projects.length}, run=${run.results.length}`);
}

const fixtureByPid = new Map(fixture.projects.map((project) => [project.pid, project]));
const seen = new Set<string>();
const rows = run.results.map((result) => {
  if (seen.has(result.pid)) throw new Error(`PID重複: ${result.pid}`);
  seen.add(result.pid);
  const project = fixtureByPid.get(result.pid);
  if (!project) throw new Error(`fixtureに存在しないPID: ${result.pid}`);
  if (result.designClarity < 0 || result.designClarity > 4) {
    throw new Error(`designClarity範囲外 PID=${result.pid}`);
  }
  if (result.evidenceReadiness < 0 || result.evidenceReadiness > 4) {
    throw new Error(`evidenceReadiness範囲外 PID=${result.pid}`);
  }
  const current = project.baseline.effective;
  const designScaled = result.designClarity * 25;
  return {
    ...result,
    name: project.name,
    cohort: project.cohort,
    currentTotal: project.baseline.total,
    current,
    designScaled,
    delta: current === null ? null : designScaled - current,
  };
});

const withCurrent = rows.filter(
  (row): row is typeof row & { current: number; delta: number } =>
    row.current !== null && row.delta !== null,
);
const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

console.log(`${run.runId}: ${rows.length}事業`);
console.log(
  `現行effective平均=${mean(withCurrent.map((row) => row.current)).toFixed(1)}, ` +
    `単体design換算平均=${mean(withCurrent.map((row) => row.designScaled)).toFixed(1)}`,
);
console.log(
  `平均絶対差=${mean(withCurrent.map((row) => Math.abs(row.delta))).toFixed(1)}, ` +
    `証拠準備度平均=${mean(rows.map((row) => row.evidenceReadiness)).toFixed(2)}/4`,
);

console.log('\nコホート別:');
for (const cohort of [...new Set(rows.map((row) => row.cohort))]) {
  const cohortRows = rows.filter((row) => row.cohort === cohort);
  const cohortWithCurrent = cohortRows.filter(
    (row): row is typeof row & { current: number; delta: number } =>
      row.current !== null && row.delta !== null,
  );
  console.log(
    `${cohort}: current=${mean(cohortWithCurrent.map((row) => row.current)).toFixed(1)}, ` +
      `design=${mean(cohortRows.map((row) => row.designScaled)).toFixed(1)}, ` +
      `evidence=${mean(cohortRows.map((row) => row.evidenceReadiness)).toFixed(2)}/4`,
  );
}

console.log('\n差が大きい事業（|差|>=20）:');
for (const row of withCurrent
  .filter((item) => Math.abs(item.delta) >= 20)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
  console.log(
    `${row.pid} ${row.name}: current=${row.current}, design=${row.designScaled}, ` +
      `delta=${row.delta > 0 ? '+' : ''}${row.delta}, evidence=${row.evidenceReadiness}/4`,
  );
}

console.log('\n低証拠準備度（0-1）:');
for (const row of rows.filter((item) => item.evidenceReadiness <= 1)) {
  console.log(`${row.pid} ${row.name}: design=${row.designClarity}/4, evidence=${row.evidenceReadiness}/4`);
}

console.log('\n現行totalが50未満でも政策設計が明瞭（design>=3）:');
for (const row of rows.filter((item) => item.currentTotal < 50 && item.designClarity >= 3)) {
  console.log(
    `${row.pid} ${row.name}: total=${row.currentTotal}, design=${row.designClarity}/4, ` +
      `evidence=${row.evidenceReadiness}/4`,
  );
}
