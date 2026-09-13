/** Read-only access probe. No mocked responses or network-policy overrides.
 * Run: node scripts/probe-taxben-browser.mjs
 * Evidence is written even when navigation is denied; failure exits nonzero.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('test-results/taxben-research');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const results = await Promise.all([
    'https://taxben.oecd.org/',
    'https://www.cas.go.jp/jp/seisaku/kokuminkaigi/contents/20260324/11_siryou11.pdf',
  ].map(async (url, index) => {
    const page = await context.newPage();
    const failures = [];
    page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure() }));
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.screenshot({ path: resolve(output, `${index}.png`) });
      writeFileSync(resolve(output, `${index}.html`), await page.content());
      const body = await page.locator('body').innerText();
      writeFileSync(resolve(output, `${index}.txt`), body);
      return { url, status: response?.status(), title: await page.title(), failures };
    } catch (error) {
      return { url, error: error.message, failures };
    }
  }));
  const report = { checkedAt: new Date().toISOString(), results };
  writeFileSync(resolve(output, 'probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (results.some(result => result.error || !result.status || result.status >= 400)) process.exitCode = 1;
} finally {
  await browser.close();
}
