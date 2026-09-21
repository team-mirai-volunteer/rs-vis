import { test, expect } from '@playwright/test';

test('medium reference appears only for fertility and updates with policies', async ({ page }) => {
  await page.goto('/fiscal-space');
  const fertility = page.locator('[data-metric="合計特殊出生率"]');
  await expect(fertility).toContainText('出生低位');
  await expect(fertility.getByTestId('medium-reference')).toContainText('出生中位 1.322');
  await expect(fertility.locator('p.text-lg')).toHaveText('1.123');
  await expect(page.getByTestId('medium-envelope-overview')).toHaveCount(0);
  await expect(page.getByTestId('medium-envelope-summary')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '出生の推計区分' })).toHaveCount(0);
  const demographics = page.getByRole('region', { name: '人口動態の経路表', exact: true });
  await expect(demographics).toContainText('30（長期）');
  await expect(demographics).toContainText('税・社会保険料収入');
  await expect(demographics.locator('small')).toHaveCount(0);
  await expect(page.getByTestId('medium-reference')).toHaveCount(1);
  await page.getByLabel('子育て・数値で入力', { exact: true }).fill('5');
  await expect(fertility.locator('p.text-lg')).not.toHaveText('1.123');
  await expect(fertility.getByTestId('medium-reference')).not.toContainText('出生中位 1.322');
  await expect(fertility.getByTestId('policy-difference')).toBeVisible();
  await page.getByTestId('horizon-toggle').getByRole('button', { name: '15年（延長）', exact: true }).click();
  await expect(page.getByTestId('horizon-results')).toContainText('15年目の結果');
  await expect(page.getByTestId('medium-reference')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(fertility).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
