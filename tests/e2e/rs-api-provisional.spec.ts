import { expect, test } from '@playwright/test';

test('2025 provisional execution: new projects use the RS API panel with correct amounts', async ({ page, request }) => {
  const r = await request.get('/api/rs-provisional/14');
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.fiscalYear).toBe(2025);
  expect(d.execution).toBe(2150767000);
  expect(d.paymentStatus).toBe('available');
  expect(d.groups.find((g: { display_code: string }) => g.display_code === 'A').total_amount).toBe(1465129000);
  // 22215（第51回衆議院議員総選挙）は前年度シートに無い新規事業なので暫定パネルになる
  const fresh = await (await request.get('/api/rs-provisional/22215')).json();
  expect(fresh.execution).toBe(81965513000);
  const apiCalls: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-22215');
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('initial');
  await expect(page.getByLabel('基準', { exact: true }).getByRole('option', { name: '執行実績（暫定）' })).toHaveCount(0);
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
  await expect(page).toHaveURL(/view=provisional/);
  await expect(page.getByTestId('rs-api-coverage')).toHaveCount(0);
  // The existing panel's test ID is intentionally absent in normal production builds.
  const panel = page;
  await expect(panel.getByTestId('rs-api-project-detail')).toContainText('81,965,513,000円');
  await expect(panel.getByTestId('rs-api-project-detail')).toContainText('政策評価は未実施です。');
  await panel.getByText('A. 都道府県：77,206,598,000円', { exact: true }).click();
  // 新規事業では前年度シートの事業データ（概要・推移・ブロック）を引かない。前年度の有無の判定に政策評価サマリ（2025年版）だけを読む
  expect(apiCalls.filter(url => url.includes('/policy-summary')).every(url => new URL(url).searchParams.get('year') === '2025')).toBe(true);
  expect(apiCalls.some(url => /project-details|project-budget-history|\/subcontracts\//.test(url))).toBe(false);
  await page.reload();
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('initial');
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
});

test('2025 provisional execution: projects in the previous sheet show the regular panel with its evaluation year', async ({ page }) => {
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-14');
  const panel = page.getByTestId('unified-side-panel');
  await expect(panel.getByText('政策評価', { exact: true })).toBeVisible();
  await expect(panel.getByText('事業概要', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: '予算・執行額の推移' })).toBeVisible();
  await expect(panel.getByTestId('rs-api-project-detail')).toHaveCount(0);
});

test('2025 budget can switch to provisional execution on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/budget-sankey?year=2025&b=initial');
  await page.getByLabel('表示プリセット').selectOption('provisional');
  await expect(page).toHaveURL(/b=initial.*view=provisional/);
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-22215');
  const panel = page;
  await panel.getByRole('button', { name: '事業概要・評価 を見る' }).click();
  await expect(panel.getByTestId('rs-api-project-detail')).toBeVisible();
  await expect(panel.getByTestId('rs-api-project-detail')).toContainText('81,965,513,000円');
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
