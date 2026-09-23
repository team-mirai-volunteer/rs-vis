import { test, expect } from '@playwright/test';

test('weighted search previews, invalidates, applies and shares preferences', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('annual-total')).toHaveText('0.0兆円');
  await page.getByRole('button', { name: '価値の重み・自動最適化', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '価値の重み・自動最適化', exact: true });
  await panel.getByLabel('追加予算の下限（兆円／年）', { exact: true }).fill('1');
  await panel.getByLabel('追加予算の上限（兆円／年）', { exact: true }).fill('1');
  await panel.getByLabel('相対的貧困率（直接効果）・重み', { exact: true }).fill('4');
  await panel.getByRole('button', { name: 'この価値観で自動探索', exact: true }).click();
  const result = panel.getByRole('region', { name: '自動探索の結果', exact: true });
  await expect(result).toContainText('候補：1兆円／年', { timeout: 60_000 });
  await expect(page.getByTestId('annual-total')).toHaveText('0.0兆円');
  await panel.getByLabel('実質GDP・重み', { exact: true }).fill('2');
  await expect(result).toContainText('条件が変わったため');
  await expect(result.getByRole('button', { name: 'この配分を適用', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'この価値観で自動探索', exact: true }).click();
  await expect(result).toContainText('候補：1兆円／年', { timeout: 60_000 });
  await result.getByRole('button', { name: 'この配分を適用', exact: true }).click();
  await expect(result.getByRole('button', { name: 'この配分を適用しました', exact: true })).toBeDisabled();
  await expect(page.getByTestId('annual-total')).toHaveText('1.0兆円');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'この条件のURLをコピー', exact: true }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await page.getByRole('button', { name: '価値の重み・自動最適化', exact: true }).click();
  await expect(panel.getByLabel('実質GDP・重み', { exact: true })).toHaveValue('2');
  await expect(panel.getByLabel('相対的貧困率（直接効果）・重み', { exact: true })).toHaveValue('4');
  await expect(panel.getByLabel('追加予算の下限（兆円／年）', { exact: true })).toHaveValue('1');
});

test('search can be stopped and invalid budgets cannot change the allocation', async ({ page }) => {
  await page.goto('/fiscal-space');
  await page.getByRole('button', { name: '価値の重み・自動最適化', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '価値の重み・自動最適化', exact: true });
  await panel.getByRole('button', { name: 'この価値観で自動探索', exact: true }).click();
  await panel.getByRole('button', { name: '探索を中止', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('探索を中止しました');
  await expect(page.getByTestId('annual-total')).toHaveText('0.0兆円');
  await panel.getByLabel('追加予算の下限（兆円／年）', { exact: true }).fill('20');
  await panel.getByRole('button', { name: 'この価値観で自動探索', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('予算の範囲');
  await expect(page.getByTestId('annual-total')).toHaveText('0.0兆円');
});

test('optimization opens beside the example without opening mobile policy controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fiscal-space');
  const actions = page.getByRole('region', { name: '条件の共有と配分例', exact: true });
  const trigger = actions.getByRole('button', { name: '価値の重み・自動最適化', exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('button', { name: /^政策を調整/ })).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  const panel = page.getByRole('dialog', { name: '価値の重み・自動最適化', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('region', { name: '価値の重み', exact: true })).toHaveAttribute('tabindex', '0');
  await page.screenshot({ path: 'test-results/optimization-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
