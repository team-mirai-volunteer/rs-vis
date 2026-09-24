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

for (const width of [1440, 900, 390]) {
  test(`bubble detail floats alongside controls or below the size legend (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/project-bubble');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await canvas.click();
    const panel = page.getByRole('region', { name: /GIGA.*の詳細/ });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/pid=1503/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (width < 640) await panel.getByRole('button', { name: '事業概要・評価 を見る' }).click();
    await expect(panel.getByText('検証可能性', { exact: true })).toBeVisible();
    const bounds = (await panel.boundingBox())!;
    const search = width >= 1280 ? (await page.getByPlaceholder('事業名・事業IDで検索').boundingBox())! : null;
    const size = (await page.getByLabel('バブルの大きさ').boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width >= 1280) expect(bounds.x).toBeGreaterThan(search!.x + search!.width);
    else expect(bounds.y).toBeGreaterThan(size.y + size.height);
    const toggle = panel.getByRole('button', { name: '事業概要', exact: true });
    await toggle.scrollIntoViewIfNeeded();
    const label = (await toggle.locator('span').boundingBox())!;
    const icon = (await toggle.locator('svg').boundingBox())!;
    const button = (await toggle.boundingBox())!;
    expect(Math.abs(label.x - button.x)).toBeLessThan(1);
    expect(icon.x - label.x - label.width).toBeLessThan(8);
    await toggle.click();
    await expect(panel.getByText('目的', { exact: true })).toBeVisible();
    const detail = await (await page.request.get('/api/project-details/1503?year=2025')).json();
    if (detail.url && /^https?:\/\//.test(detail.url)) {
      await expect(panel.getByRole('link', { name: '事業概要URL', exact: true })).toHaveAttribute('href', detail.url);
    }
    await expect(panel.getByRole('tab')).toHaveText(['予算', '事業(支出)', 'ブロック', '支出先']);
    await panel.getByRole('tab', { name: 'ブロック', exact: true }).click();
    await expect(panel.getByRole('link', { name: /フローを見る/ })).toHaveAttribute('href', '/subcontracts/1503?fiscalYear=2024');
    await panel.getByRole('tabpanel').getByRole('button').first().click();
    await expect(panel.getByRole('region', { name: 'ブロックの差額' })).toBeVisible();
    await page.screenshot({ path: `test-results/bubble-detail-${width}.png` });
    await panel.getByRole('button', { name: '選択を解除', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/pid=/);
    await expect(canvas).toBeVisible();
  });
}

test('table selection and a shared URL open the same floating panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/project-bubble?tb=1');
  await page.getByRole('button', { name: 'GIGAスクール構想', exact: true }).click();
  const panel = page.getByRole('region', { name: /GIGA.*の詳細/ });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/pid=1503/);
  await page.reload();
  await expect(panel).toBeVisible();
  await panel.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
