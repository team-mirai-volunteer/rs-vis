import { expect, test } from '@playwright/test';

test('2025 provisional execution has correct amounts and no previous-sheet detail APIs', async ({ page, request }) => {
  const r = await request.get('/api/rs-provisional/14');
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.fiscalYear).toBe(2025);
  expect(d.execution).toBe(2150767000);
  expect(d.paymentStatus).toBe('available');
  expect(d.groups.find((g: { display_code: string }) => g.display_code === 'A').total_amount).toBe(1465129000);
  const apiCalls: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-14');
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('initial');
  await expect(page.getByLabel('基準', { exact: true }).getByRole('option', { name: '執行実績（暫定）' })).toHaveCount(0);
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
  await expect(page).toHaveURL(/view=provisional/);
  await expect(page.getByTestId('rs-api-coverage')).toHaveCount(0);
  // The existing panel's test ID is intentionally absent in normal production builds.
  const panel = page;
  await expect(panel.getByTestId('rs-api-project-detail')).toContainText('2,150,767,000円');
  await expect(panel.getByRole('link', { name: 'RSシートの出典' })).toHaveAttribute('href', /f8dc3b7b-0a06-4c7e-b16c-5cbb27d68d01/);
  await panel.getByText('A. 一般社団法人行政情報システム研究所：1,465,129,000円', { exact: true }).click();
  await expect(panel.getByTestId('rs-api-project-detail')).toContainText('788,790,000円');
  expect(apiCalls.some(url => /policy-summary|project-details|project-budget-history|\/subcontracts\//.test(url))).toBe(false);
  await page.reload();
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('initial');
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
});

test('2025 budget can switch to provisional execution on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/budget-sankey?year=2025&b=initial');
  await page.getByLabel('表示プリセット').selectOption('provisional');
  await expect(page).toHaveURL(/b=initial.*view=provisional/);
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-14');
  const panel = page;
  await panel.getByRole('button', { name: '事業概要・評価 を見る' }).click();
  await expect(panel.getByTestId('rs-api-project-detail')).toBeVisible();
  await expect(panel.getByTestId('rs-api-project-detail')).toContainText('2,150,767,000円');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('MOF basis and provisional view are independent and survive reload', async ({ page }) => {
  await page.goto('/budget-sankey?year=2025&b=supplementary');
  await page.getByLabel('表示プリセット').selectOption('provisional');
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('supplementary');
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
  await page.reload();
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('supplementary');
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
  await page.getByLabel('基準', { exact: true }).selectOption('initial');
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
  await page.getByLabel('表示プリセット').selectOption('full');
  await expect(page.getByTestId('rs-api-coverage')).toHaveCount(0);
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('initial');
});
