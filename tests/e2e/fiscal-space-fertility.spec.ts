import { test, expect } from '@playwright/test';

test('low fertility is primary and medium is a small, recalculated reference', async ({ page }) => {
  await page.goto('/fiscal-space');
  const fertility = page.locator('[data-metric="合計特殊出生率"]');
  await expect(fertility).toContainText('出生低位');
  await expect(fertility.getByTestId('medium-reference')).toContainText('中位 1.322');
  await expect(fertility.locator('p.text-lg')).toHaveText('1.123');
  await expect(page.getByTestId('medium-envelope-overview')).toBeVisible();
  await expect(page.getByTestId('medium-envelope-summary')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '出生の推計区分' })).toHaveCount(0);
  const demographics = page.getByRole('region', { name: '人口動態の経路表', exact: true });
  await expect(demographics).toContainText('30（長期）');
  await expect(demographics).toContainText('税・社会保険料収入');
  await expect(demographics.locator('small').first()).toContainText('中位');
  await page.getByLabel('子育て・数値で入力', { exact: true }).fill('5');
  await expect(fertility.locator('p.text-lg')).not.toHaveText('1.123');
  await expect(fertility.getByTestId('medium-reference')).not.toHaveText('中位 1.322');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(fertility).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
