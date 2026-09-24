import { expect, test } from '@playwright/test';

test('事業の推移セクションで2025年版の過年度値を表示し、当年度の未確定実績を区別する', async ({ page, request }) => {
  const response = await request.get('/api/project-budget-history/1');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.sheetYear).toBe(2025);
  expect(data.points.find((point: { fiscalYear: number }) => point.fiscalYear === 2025).executedAmount).toBeNull();
  expect(data.points.find((point: { fiscalYear: number }) => point.fiscalYear === 2024).executedAmount).toBe(10395000);
  expect((await request.get('/api/project-budget-history/invalid')).status()).toBe(400);
  expect((await (await request.get('/api/project-budget-history/999999999')).json()).points).toEqual([]);

  await page.goto('/budget-sankey?year=2024&b=initial&sel=project-budget-1');
  const panel = page.getByTestId('unified-side-panel');
  const history = panel.getByRole('region', { name: '予算・執行額の推移' });
  await expect(history).toBeVisible();
  await expect(history.locator('svg')).toBeVisible();
  await expect(history.locator('button, dl, table')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await history.getByRole('button', { name: '2025年度の金額', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('未確定');
  await history.getByRole('button', { name: '2024年度の金額', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('1039.50万円');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(history.getByRole('link', { name: '出典' })).toHaveAttribute('href', 'https://rssystem.go.jp/download-csv/2025');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: '事業概要・評価 を見る' }).click();
  await history.getByRole('button', { name: '2025年度の金額', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('未確定');
  expect(await history.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
});
