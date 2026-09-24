import { test, expect } from '@playwright/test';

test('2024年度の支出から委託構造・評価・共有先まで年度とブロック数が一致する', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/budget-sankey?year=2024&sel=project-spending-1503');
  const panel = page.getByTestId('unified-side-panel');
  await panel.getByRole('tab', { name: /^ブロック/ }).click();
  await page.getByRole('link', { name: 'フローを見る ↗' }).click();
  await expect(page).toHaveURL(/subcontracts\/1503\?fiscalYear=2024/);
  await expect(page.getByLabel('年度', { exact: true }).locator('option:checked')).toHaveText('2024年度');
  await expect(page.getByText('ブロック 3', { exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: '一覧で見る →' });
  const href = await link.getAttribute('href');
  await page.goto(href!);
  await page.getByRole('row').filter({ hasText: 'GIGA' }).getByRole('button', { name: '詳細', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ブロック:3件');
  await dialog.getByRole('button', { name: '詳細URLをコピー', exact: true }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('fiscalYear=2024&detail=1503');
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const receiver = await fresh.newPage();
  await receiver.goto(url);
  await expect(receiver.getByRole('dialog')).toContainText('2024年度');
  await expect(receiver.getByRole('dialog')).toContainText('ブロック:3件');
  await fresh.close();
});

test('スマホで支出先とブロックのタブが最初から見え、委託元を辿れる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/budget-sankey?year=2024&sel=project-spending-7');
  const panel = page.getByTestId('unified-side-panel');
  const recipients = panel.getByRole('tab', { name: /^支出先/ });
  const blocks = panel.getByRole('tab', { name: /^ブロック/ });
  await expect(recipients).toBeInViewport();
  await expect(blocks).toBeInViewport();
  await expect(recipients).toHaveAttribute('aria-selected', 'true');
  await blocks.click();
  await expect(panel).toContainText('委託元：B 株式会社読売広告社ほか');
  await expect(panel).toContainText('委託元：G 株式会社博報堂DYメディアパートナーズほか');
  const before = (await panel.boundingBox())!.height;
  await panel.getByRole('button', { name: '詳細を大きく表示' }).click();
  expect((await panel.boundingBox())!.height).toBeGreaterThan(before);
  await page.screenshot({ path: 'test-results/review-mobile-panel.png' });
  await page.getByRole('link', { name: 'フローを見る ↗' }).click();
  await expect(page.getByRole('tab', { name: /^ブロック/ })).toBeInViewport();
  await page.getByRole('tab', { name: /^ブロック/ }).click();
  await expect(page.locator('aside')).toContainText('委託元：B 株式会社読売広告社ほか');
});
