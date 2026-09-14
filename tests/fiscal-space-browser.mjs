/** Production Next smoke: start the built app first. No Link/Image or model mocks. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.FISCAL_SPACE_BASE_URL ?? 'http://localhost:3107';
const output = resolve('test-results/fiscal-space');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.locator('main a[href="/fiscal-space"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('次の1兆円で、何が最初に足りなくなる？');
  await expect(page.getByRole('meter')).toHaveCount(10);
  const comparison = page.getByRole('region', { name: '次の1兆円の政策比較表' });
  await expect(comparison.locator('tbody tr')).toHaveCount(13);
  const before = await comparison.innerText();
  await page.getByLabel('総額を数値入力（兆円）').fill('20');
  await expect(page.getByLabel('年間追加総額', { exact: true })).toHaveValue('20');
  await expect.poll(() => comparison.innerText()).not.toEqual(before);
  const initialMeter = await page.getByRole('meter', { name: '産業別能力の閾値利用率' }).getAttribute('aria-valuetext');
  await page.getByLabel('公共投資', { exact: true }).fill('10');
  await expect.poll(() => page.getByRole('meter', { name: '産業別能力の閾値利用率' }).getAttribute('aria-valuetext')).not.toEqual(initialMeter);
  await page.getByText('経済状態・評価条件を変える', { exact: true }).click();
  await page.getByLabel('債務経路 上限（%）').fill('100');
  await expect(page.getByText('追加政策なしの経路に既存の制約違反があるため', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '初期条件に戻す' }).click();
  await expect(page.getByLabel('年間追加総額', { exact: true })).toHaveValue('10');
  await page.getByText('借換と利払いの根拠を見る', { exact: true }).click();
  await expect(page.getByRole('rowheader', { name: '+100bp', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  await page.screenshot({ path: resolve(output, 'desktop-overview.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No whole-page horizontal overflow');
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  await page.screenshot({ path: resolve(output, 'mobile-overview.png') });
  await page.getByRole('link', { name: '計算とデータについて' }).click();
  await expect(page.getByRole('heading', { name: '計算根拠・データ・レジリエンス' })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Passed: home navigation, 13 policies, live amount/mix, baseline violation, reset, rollover, desktop/mobile, explanations; zero page errors.');
} finally { await browser.close(); }
