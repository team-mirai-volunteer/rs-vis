import { expect, test } from '@playwright/test';

test('2025 provisional execution: new projects show RS API data in the usual sections and tabs', async ({ page, request }) => {
  const r = await request.get('/api/rs-provisional/14');
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.fiscalYear).toBe(2025);
  expect(d.execution).toBe(2150767000);
  expect(d.paymentStatus).toBe('available');
  expect(d.groups.find((g: { display_code: string }) => g.display_code === 'A').total_amount).toBe(1465129000);
  // 22215（第51回衆議院議員総選挙）は前年度シートに無い新規事業。API の概要・ブロックをいつもの場所に出す
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
  const panel = page.getByTestId('unified-side-panel');
  await expect(panel.getByText('この事業はまだ政策評価を実施していません（RS公開APIから暫定取得した新規事業）。')).toBeVisible();
  await expect(panel.getByText('事業概要', { exact: true })).toBeVisible();
  await panel.getByRole('tab', { name: /^ブロック/ }).click();
  const blocks = panel.getByRole('tabpanel');
  await expect(blocks).toContainText('RS公開APIからの暫定取得');
  await expect(blocks.getByRole('button', { name: /^A 都道府県\s*772\.07億円/ })).toBeVisible();
  await blocks.getByRole('button', { name: /^A 都道府県/ }).click();
  await expect(panel.getByRole('tab', { name: /^支出先/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('tabpanel')).toContainText('ブロック A 都道府県');
  // 前年度の有無の判定に政策評価サマリ（2025年版）だけを読み、前年度シートの事業概要・再委託構造は引かない
  expect(apiCalls.filter(url => url.includes('/policy-summary')).every(url => new URL(url).searchParams.get('year') === '2025')).toBe(true);
  expect(apiCalls.some(url => /project-details|\/subcontracts\//.test(url))).toBe(false);
  await page.reload();
  await expect(page.getByLabel('基準', { exact: true })).toHaveValue('initial');
  await expect(page.getByLabel('表示プリセット')).toHaveValue('provisional');
});

test('2025 provisional execution: projects in the previous sheet use its sections and the current RS API blocks', async ({ page }) => {
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-14');
  const panel = page.getByTestId('unified-side-panel');
  await expect(panel.getByText('政策評価', { exact: true })).toBeVisible();
  await expect(panel.getByText('事業概要', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: '予算・執行額の推移' })).toBeVisible();
  // ブロックは当年度（API）の値。14 の A ブロックは 1,465,129,000円
  await panel.getByRole('tab', { name: /^ブロック/ }).click();
  await expect(panel.getByRole('tabpanel').getByRole('button', { name: /^A .*14\.65億円/ })).toBeVisible();
  await expect(panel.getByTestId('rs-api-project-detail')).toHaveCount(0);
});

test('2025 budget can switch to provisional execution on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/budget-sankey?year=2025&b=initial');
  await page.getByLabel('表示プリセット').selectOption('provisional');
  await expect(page).toHaveURL(/b=initial.*view=provisional/);
  await page.goto('/budget-sankey?year=2025&b=execution&sel=project-budget-22215');
  const panel = page.getByTestId('unified-side-panel');
  await panel.getByRole('button', { name: '事業概要・評価 を見る' }).click();
  await expect(panel.getByText('この事業はまだ政策評価を実施していません（RS公開APIから暫定取得した新規事業）。')).toBeVisible();
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
