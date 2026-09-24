import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // クリック座標だけを固定し、事業詳細・評価・支出先は実際のAPIで確認する。
  await page.route('**/api/project-map?*', route => route.fulfill({ json: {
    year: 2025, model: 'test', generatedAt: '', quality: { kmeansAriVsPolicyCategory: 0 },
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, clusters: [],
    points: [{ pid: '1503', name: 'GIGAスクール構想', ministry: '文部科学省', x: 0, y: 0, c: 0,
      budget: 508000000, exec: 600000000, score: 50, prop: 50, nec: 50, years: 5, cat: null, rec: null }],
    summary: { total: 1, ministries: [{ name: '文部科学省', count: 1 }], scored: 1 },
  } }));
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({ json: { comments: [], total: 0, nextCursor: null } }));
});

for (const width of [1440, 390]) {
  test(`bubble click opens the shared detail in the center (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/project-bubble');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await canvas.click();
    const dialog = page.getByRole('dialog', { name: /GIGA.*の詳細/ });
    await expect(dialog.getByText('PID 1503', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/pid=1503/);
    await expect(dialog.getByText('目的', { exact: true })).toBeVisible();
    await expect(dialog.getByText('検証可能性', { exact: true }).first()).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - 450)).toBeLessThan(3);
    await dialog.getByPlaceholder('支出先名で検索...').scrollIntoViewIfNeeded();
    await expect(dialog.getByPlaceholder('支出先名で検索...')).toBeVisible();
    const last = dialog.locator('button, a[href], input').last();
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: '詳細URLをコピー', exact: true })).toBeFocused();
    await page.screenshot({ path: `test-results/bubble-detail-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/pid=/);
    await expect(canvas).toBeVisible();
  });
}

test('table selection, retry and a shared URL open the same popup', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let fail = true;
  await page.route('**/api/quality-scores/1503?*', route => fail ? route.fulfill({ status: 503, json: {} }) : route.continue());
  await page.goto('/project-bubble?tb=1');
  await page.getByRole('button', { name: 'GIGAスクール構想', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('取得できませんでした');
  fail = false;
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('PID 1503', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByText('PID 1503', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '閉じる（Esc）', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'GIGAスクール構想', exact: true })).toBeVisible();
});
