/**
 * AI 政策評価のシステムプロンプトを書き出す（サンキー図の「説明」から全文を読めるようにする）。
 *   node scripts/export-evaluation-prompt.mjs [2025 2024]
 * score-project-quality-ai.py --dump-prompt を API キー無しで実行する（LLM を呼ばない）。出力: public/policy-evaluation/prompt-{シート年度}.txt
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const years = process.argv.slice(2).length ? process.argv.slice(2) : ['2025', '2024'];
const python = process.platform === 'win32' ? 'python' : 'python3';
fs.mkdirSync('public/policy-evaluation', { recursive: true });
for (const year of years) {
  const env = { ...process.env, OPENROUTER_API_KEY: '', GOOGLE_API_KEY: '', PYTHONIOENCODING: 'utf-8' };
  const run = spawnSync(python, ['scripts/score-project-quality-ai.py', '--year', year, '--dump-prompt'], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`dump failed for ${year}: ${run.stderr}`);
  // 区切り線（=== が 100 個）の 1 本目と 2 本目の間がシステムプロンプト
  const parts = run.stdout.split(/^={100}$/m);
  if (parts.length < 3) throw Error(`unexpected dump output for ${year}`);
  const system = parts[1].trim();
  const header = `# AI 政策評価のシステムプロンプト（${year}年版レビューシートの採点に使用）\n# 生成: scripts/score-project-quality-ai.py（--dump-prompt）\n\n`;
  const file = path.join('public/policy-evaluation', `prompt-${year}.txt`);
  fs.writeFileSync(file, header + system + '\n');
  console.log(`${file}: ${system.length.toLocaleString()} chars`);
}
