/**
 * RSシステム（rssystem.go.jp）のCSV ZIPを Playwright で取得する。
 *
 * ダウンロードページはJS描画で、ZIPリンクは <a> ではなくクリック要素のため
 * curl/WebFetch では取れない。リポジトリ既存の Playwright（@playwright/test の
 * Chromium）でページを開き、ファイル名テキストの行にある「ZIP」をクリックして
 * download イベントで保存する。
 *
 * 使用法:
 *   node scripts/download-rs-csv.mjs <RS年度> [ファイル接頭辞...]
 *   例: node scripts/download-rs-csv.mjs 2025 1-1 2-2
 *   接頭辞を省略すると 1-1 1-2 2-1 2-2 5-1 5-2 5-3（主要パイプラインの入力）を取得する。
 *
 * 出力: data/download/RS_{年度}/{ファイル名}.zip
 * 展開は scripts/extract-rs-csv.py（data/year_{年度}/ に UTF-8 CSV を置く）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PREFIXES = ['1-1', '1-2', '2-1', '2-2', '5-1', '5-2', '5-3'];

/** 正規表現のメタ文字をエスケープする（ファイル名に「・」「（」等が含まれるため） */
function escapeRegExp(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2000 || year > 2100) {
  console.error('使用法: node scripts/download-rs-csv.mjs <RS年度> [接頭辞...]');
  process.exit(1);
}
const prefixes = process.argv.slice(3).length ? process.argv.slice(3) : DEFAULT_PREFIXES;
const outDir = path.join('data', 'download', `RS_${year}`);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const url = `https://rssystem.go.jp/download-csv/${year}`;
console.log(`open ${url}`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });

// 一覧はクライアント側で描画されるため networkidle だけでは間に合わないことがある。
// ファイル名の行（「1-1_…ZIP」形式）が現れるまで待ってから本文を読む。
await page.locator('tr, li').filter({ hasText: /^\d-\d_.*ZIP$/ }).first()
  .waitFor({ state: 'attached', timeout: 60_000 })
  .catch(() => {});

// ページに載っている全ファイル名（「1-1_基本情報_組織情報」形式）を拾う
const bodyText = await page.textContent('body');
const listed = [...(bodyText ?? '').matchAll(/(\d-\d)_([^\sZ]+?)ZIP/g)].map(m => ({ prefix: m[1], label: `${m[1]}_${m[2]}` }));
if (listed.length === 0) {
  console.error('ダウンロード一覧が見つかりません（ページ構造が変わった可能性）');
  await browser.close();
  process.exit(1);
}

let failed = 0;
for (const prefix of prefixes) {
  const target = listed.find(l => l.prefix === prefix);
  if (!target) {
    console.warn(`  ⚠ ${prefix}: 一覧に無い（${listed.map(l => l.prefix).join(' ')}）`);
    failed++;
    continue;
  }
  const row = page.locator('tr, li, div', { hasText: new RegExp('^' + escapeRegExp(target.label)) }).last();
  const zipEl = row.getByText('ZIP', { exact: true }).first();
  try {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), zipEl.click()]);
    const dest = path.join(outDir, download.suggestedFilename());
    await download.saveAs(dest);
    console.log(`  ✅ ${path.basename(dest)} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (e) {
    console.error(`  ❌ ${prefix}: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
