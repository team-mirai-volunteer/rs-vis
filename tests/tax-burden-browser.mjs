/** Offline browser smoke test: actual React page, actual generated JSON, Next Link/Image adapters only.
 * Useful in managed environments where listening on a localhost socket is prohibited.
 * This does not replace the Next integration test in tests/e2e/tax-burden.spec.ts.
 */
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const output = resolve('test-results/tax-burden-browser');
mkdirSync(output, { recursive: true });
const bundle = resolve(output, 'page.js');
await build({
  absWorkingDir: process.cwd(),
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', baseUrl: '.', paths: { '@/*': ['./*'] } } },
  stdin: { contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from './app/tax-burden/page'; createRoot(document.getElementById('root')).render(<Page/>);", resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, outfile: bundle, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'next-adapters', setup(builder) {
    builder.onResolve({ filter: /^next\/(link|image)$/ }, args => ({ path: args.path, namespace: 'next-adapter' }));
    builder.onLoad({ filter: /.*/, namespace: 'next-adapter' }, args => ({
      contents: args.path.endsWith('image')
        ? "import React from 'react'; export default function Image({priority, ...props}) {return <img {...props}/>;}"
        : "import React from 'react'; export default function Link({children,...props}) {return <a {...props}>{children}</a>;}",
      loader: 'tsx', resolveDir: process.cwd(),
    }));
    // Resolve through Node to avoid esbuild traversing unreadable parent directories in the sandbox.
    builder.onResolve({ filter: /.*/ }, args => {
      const base = args.importer && args.namespace !== 'next-adapter' ? dirname(args.importer) : process.cwd();
      const request = args.path.startsWith('@/') ? resolve(process.cwd(), args.path.slice(2))
        : args.path.startsWith('.') ? resolve(base, args.path) : args.path;
      const candidate = [request, `${request}.tsx`, `${request}.ts`, `${request}.js`].find(p => existsSync(p) && extname(p));
      return { path: candidate ?? createRequire(resolve(base, 'package.json')).resolve(request), namespace: 'node-file' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'node-file' }, args => ({
      contents: readFileSync(args.path, 'utf8'), loader: extname(args.path) === '.tsx' ? 'tsx' : extname(args.path) === '.ts' ? 'ts' : 'js', resolveDir: dirname(args.path),
    }));
  } }],
});
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'app/globals.css', '-o', resolve(output, 'page.css')], { stdio: 'pipe' });
const css = readFileSync(resolve(output, 'page.css'), 'utf8');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/page.js"></script></body></html>`;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://tax-burden.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/page.js') return route.fulfill({ contentType: 'application/javascript', body: readFileSync(bundle) });
    if (url.pathname.startsWith('/logos/')) return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(resolve('public/logos/team-mirai-wordmark.svg')) });
    if (url.pathname.startsWith('/api/tax-burden/')) {
      const name = url.pathname.endsWith('params') ? 'tax-burden-params-2025' : url.pathname.endsWith('consumption') ? 'tax-burden-consumption-2024'
        : url.pathname.endsWith('oecd') ? 'tax-burden-oecd-2025' : url.pathname.endsWith('age') ? 'tax-burden-age-2024' : 'tax-revenue-2025';
      return route.fulfill({ contentType: 'application/json', body: readFileSync(resolve(`public/data/${name}.json`)) });
    }
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('http://tax-burden.test/tax-burden');
  await expect(page.getByRole('table').first()).toBeVisible();
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '改革案を比較', exact: true }).click();
  await page.getByLabel('給付付き控除・世帯年額', { exact: true }).fill('30');
  await expect(page.getByText('100,000円', { exact: true }).first()).toBeVisible();
  const shared = page.url();
  await page.reload();
  await expect(page.getByLabel('給付付き控除・世帯年額', { exact: true })).toHaveValue('30');
  expect(page.url()).toBe(shared);
  await page.getByRole('button', { name: 'データについて', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '国の税収', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: '法人税', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'revenue.png'), fullPage: true });
  await page.getByRole('button', { name: '実態統計', exact: true }).click();
  await expect(page.getByRole('heading', { name: '年収十分位別の負担率（実測＋消費税推計）' })).toBeVisible();
  await page.getByRole('button', { name: '負担額（年額）', exact: true }).click();
  await expect(page.getByRole('heading', { name: '年収十分位別の負担額（実測＋消費税推計）' })).toBeVisible();
  await page.getByRole('button', { name: '世帯主の年齢', exact: true }).click();
  await expect(page.getByRole('heading', { name: '世帯主年齢階級別の負担額（実測＋消費税推計）' })).toBeVisible();
  await page.getByRole('button', { name: '無職世帯', exact: true }).click();
  await expect(page.getByText('85歳～', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: resolve(output, 'stats-age.png'), fullPage: true });
  await page.getByRole('button', { name: '年収階級', exact: true }).click();
  await page.getByRole('button', { name: '負担率', exact: true }).click();
  await page.getByRole('button', { name: '年齢で見る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '同じ所得階層の人が、年齢とともにどれだけ負担するか' })).toBeVisible();
  await expect(page.getByText('70歳の純負担率', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'age.png'), fullPage: true });
  await page.getByRole('button', { name: '税目×年齢×年収', exact: true }).click();
  await expect(page.getByRole('table', { name: /ヒートマップ/ })).toHaveCount(10);
  await expect(page.getByRole('heading', { name: '税目ごとに分解する' })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'heatmap.png'), fullPage: true });
  await page.getByRole('button', { name: '世帯の負担カーブ', exact: true }).click();
  await page.getByLabel('消費税（推計）を含める').check();
  await page.getByLabel('OECD平均・最小・最大を重ねる').check();
  await expect(page.getByText('OECD平均', { exact: true }).first()).toBeVisible();
  await page.getByRole('combobox', { name: /^家族構成/ }).selectOption('two-earners-children');
  await expect(page.getByText(/連続系列はOECDに公開されていません/)).toBeVisible();
  await page.getByRole('combobox', { name: /^家族構成/ }).selectOption('one-earner-children');
  await page.screenshot({ path: resolve(output, 'curve-oecd.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '世帯の負担カーブ', exact: true }).click();
  await expect(page.getByRole('table').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  await page.getByLabel('世帯年収を万円で入力').fill('0');
  await expect(page.getByText('未定義', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ passed: true, pageErrors: errors, integration: 'offline React page; Next Link/Image adapted; actual generated data', screenshots: ['desktop.png', 'mobile.png', 'revenue.png', 'age.png', 'heatmap.png', 'curve-oecd.png'] }, null, 2));
  console.log(`PASS: offline browser smoke test; desktop/mobile screenshots in ${output}`);
} finally { await browser.close(); }
