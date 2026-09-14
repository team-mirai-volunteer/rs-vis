import { test, expect } from '@playwright/test';

test('tax prototype: reform, shared conditions, actual revenue, unavailable statistics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tax-burden');
  await expect(page.getByRole('heading', { name: '誰が、どれだけ負担している？' })).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await page.getByRole('button', { name: /^税・給付/ }).click();
  await page.getByLabel('給付付き控除（年額）・数値で入力', { exact: true }).fill('30');
  await expect(page.getByText('100,000円', { exact: true }).first()).toBeVisible();
  const url = page.url();
  await page.reload();
  await page.getByRole('button', { name: /^税・給付/ }).click();
  await expect(page.getByLabel('給付付き控除（年額）・数値で入力', { exact: true })).toHaveValue('30');
  expect(page.url()).toBe(url);
  await page.getByRole('button', { name: 'データについて', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '国の税収', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: '法人税', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '実態統計', exact: true }).click();
  await expect(page.getByRole('heading', { name: '年収十分位別の負担率（実測＋消費税推計）' })).toBeVisible();
  await page.getByRole('button', { name: '年齢で見る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '同じ所得階層の人が、年齢とともにどれだけ負担するか' })).toBeVisible();
  await page.getByRole('button', { name: '税目×年齢×年収', exact: true }).click();
  await expect(page.getByRole('table', { name: /ヒートマップ/ })).toHaveCount(10);
  await expect(page.getByRole('heading', { name: '税目ごとに分解する' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile: no horizontal overflow and zero income is not a numeric rate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tax-burden');
  await expect(page.getByRole('table').first()).toBeVisible();
  await page.getByLabel('世帯年収を万円で入力').fill('0');
  await expect(page.getByText('未定義', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
