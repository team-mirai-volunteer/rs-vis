import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
const errors = [];
await mkdir('test-results/tax-expenditures', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:3000'}/tax-expenditures`);
  await expect(page.getByRole('heading', { name: '租税特別措置(試作)', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('79 / 79');
  await page.screenshot({ path: 'test-results/tax-expenditures/desktop.png' });
  await page.getByRole('searchbox').fill('ふるさと納税');
  await expect(page.getByRole('status')).toContainText('1 / 79');
  const measure = page.locator('details').filter({ hasText: '認定地方公共団体の寄附活用事業' });
  await measure.locator('summary').click();
  await expect(measure.getByRole('cell', { name: '2,899,075', exact: true })).toBeVisible();
  await page.getByLabel('適用年度', { exact: true }).selectOption('2022');
  await expect(measure.getByRole('cell', { name: '1,272,063', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('存在しない制度xyz');
  await expect(page.getByText('該当する制度がありません。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'RSとの関連を確認する' }).click();
  await expect(page.getByRole('status')).toContainText('1 / 79');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('details').filter({ hasText: '認定地方公共団体の寄附活用事業' }).locator('summary').click();
  await page.screenshot({ path: 'test-results/tax-expenditures/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: /地方創生応援税制（企業版ふるさと納税）普及促進事業/ }).click();
  await expect(page).toHaveURL(/quality\?fiscalYear=2024&pid=127&detail=127/);
  await expect(page.getByText('地方創生応援税制(企業版ふるさと納税)普及促進事業', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  expect(errors).toEqual([]);
  console.log('Tax expenditures: search, years, missing result, RS link, mobile overflow passed.');
} finally {
  await browser.close();
}
