import { expect, test } from '@playwright/test';

test('subcontract detail does not overwrite titles after navigation', async ({ page }) => {
  await page.goto('/subcontracts/1503?fiscalYear=2024');
  await expect(page).toHaveTitle(/^再委託 .+/, { timeout: 60_000 });

  // [ナビの短い名前, ページタイトルの正式名]（components/navigation/pages.ts の navLabel と label）
  for (const [navLabel, label] of [['評価一覧', '評価一覧'], ['バブル図', 'バブルチャート'], ['サンキー図', 'サンキー図'], ['委託構造', '委託構造']]) {
    await page.getByRole('link', { name: navLabel, exact: true }).first().click();
    await expect(page).toHaveTitle(`${label}｜行政事業レビュー可視化`);
    await page.goBack();
    await expect(page).toHaveTitle(/^再委託 .+/, { timeout: 60_000 });
  }
});
