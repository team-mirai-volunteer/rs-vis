#!/usr/bin/env tsx

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const root = resolve(__dirname, '..');
const fixture = JSON.parse(
  readFileSync(resolve(root, 'tests/fixtures/quality-evaluation-benchmark-30.json'), 'utf8'),
) as {
  projects: Array<{
    pid: string;
    name: string;
    ministry: string;
    cohort: string;
  }>;
};
const benchmark = JSON.parse(
  readFileSync(
    resolve(root, 'tests/benchmark-results/openrouter-model-optimization-2026-07-26.json'),
    'utf8',
  ),
) as {
  runs: Array<{
    model: string;
    results: Array<{
      pid: string;
      evidenceReadiness: number;
      confidence: number;
    }>;
  }>;
};
const luna = benchmark.runs.find((run) => run.model === 'openai/gpt-5.6-luna')!;
const lunaByPid = new Map(luna.results.map((result) => [result.pid, result]));
const outputPath = resolve(
  root,
  'docs/exports/policy-effect-value-abolition-template-2026-07-26.csv',
);

const headers = [
  '事業ID',
  '事業名',
  '府省庁',
  '証拠準備度（0〜4）',
  '証拠信頼度（0〜1）',
  '政策効果スコア（0〜100）',
  '政策価値スコア（0〜100）',
  '廃止優先度（0〜100）',
  '推奨アクション',
  '現在の判定状態',
  '不足データ',
];

const quote = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const rows = fixture.projects.map((project) => {
  const result = lunaByPid.get(project.pid)!;
  return [
    project.pid,
    project.name,
    project.ministry,
    result.evidenceReadiness,
    result.confidence.toFixed(2),
    '',
    '',
    '',
    'EVIDENCE_REQUIRED',
    '判定不能',
    '3-1成果目標・実績、3-2効果発現経路、4-1点検・評価、比較対象、費用対効果',
  ];
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `\uFEFF${[headers, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`,
  'utf8',
);
console.log(`Wrote ${rows.length} rows to ${outputPath}`);
