import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`navigation preserves the header and replaces page controls (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/budget-sankey?year=2024');
    await expect(page.getByTestId('unified-canvas')).toBeVisible();
    const header = await page.getByRole('banner').elementHandle();
    const menu = await page.getByRole('button', { name: 'ページ切替メニュー' }).elementHandle();
    await page.getByRole('button', { name: 'ページ切替メニュー' }).click();
    await page.getByRole('link', { name: '評価一覧', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: '事業別 政策評価・執行透明性スコア' })).toBeVisible();
    expect(await header!.evaluate(el => el.isConnected)).toBe(true);
    expect(await menu!.evaluate(el => el.isConnected)).toBe(true);
    await expect(page.getByRole('button', { name: 'ページ切替メニュー' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByLabel('年度', { exact: true }).selectOption('2024');
    await expect(page).toHaveURL(/year=2024/);
    if (width >= 1280) {
      await page.getByRole('navigation', { name: '主要ビュー' }).getByRole('link', { name: '委託構造', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'ページ切替メニュー' }).click();
      await page.getByRole('link', { name: '委託構造', exact: true }).last().click();
    }
    await expect(page.locator('thead th')).toHaveCount(23);
    expect(await header!.evaluate(el => el.isConnected)).toBe(true);
    await page.goBack();
    await expect(page.getByRole('heading', { name: '事業別 政策評価・執行透明性スコア' })).toBeVisible();
    expect(await header!.evaluate(el => el.isConnected)).toBe(true);
    await page.getByRole('link', { name: '行政事業レビュー可視化 トップ', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await menu!.evaluate(el => el.isConnected)).toBe(true);
    await expect(page.getByLabel('年度', { exact: true })).toHaveCount(0);
  });
}

test('public pages have distinct titles and usable social cards before JavaScript runs', async ({ request }) => {
  const titles = new Set<string>();
  for (const path of ['/', '/budget-sankey', '/quality', '/subcontracts', '/project-bubble', '/fiscal-space', '/tax-burden']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    expect(title).toBeTruthy();
    expect(titles.has(title!)).toBe(false);
    titles.add(title!);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    const og = html.match(/property="og:image" content="([^"]+)"/)?.[1];
    expect(og).toBeTruthy();
    expect(new URL(og!).pathname).toBe(`/og/${path === '/' ? 'home' : path.slice(1)}.png`);
    const image = await request.get(new URL(og!).pathname);
    expect(image.headers()['content-type']).toContain('image/png');
    const bytes = await image.body();
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    expect(bytes.length).toBeGreaterThan(5000);
  }
});

test('mobile quality shows the evaluation and opens details without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({ json: { comments: [], total: 0, nextCursor: null } }));
  await page.goto('/quality?year=2025');
  await page.getByRole('textbox', { name: '事業を検索', exact: true }).fill('1503');
  const list = page.getByRole('list', { name: '事業の評価' });
  const card = list.getByRole('listitem').filter({ hasText: 'GIGA' });
  await expect(card).toHaveCount(1);
  await expect(list).toContainText('GIGA');
  await expect(list).toContainText('総合点');
  await expect(list).toContainText('予算額');
  await expect(list).toContainText('執行額');
  const button = card.getByRole('button', { name: '評価・支出先の詳細' });
  await expect(button).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/quality-mobile.png' });
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/detail=1503/);
  await page.keyboard.press('Escape');
  await page.getByLabel('年度', { exact: true }).selectOption('2026');
  await expect(list).toContainText('予算額（要求）');
  await expect(list).toContainText('未収録');
});

test('budget flow uses the space below navigation and starts with all labels', async ({ page }) => {
  await page.goto('/budget-sankey?year=2024');
  await expect(page.getByText('左から右へ、お金の流れをたどれます。', { exact: false })).toHaveCount(0);
  await expect(page).toHaveURL(/ld=all/);
  await expect(page.getByTestId('unified-canvas')).toBeVisible();
  await page.getByRole('button', { name: '表示設定を開く', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'すべてのノードラベルを表示' })).toBeChecked();
  await expect(page.getByRole('button', { name: '基準フォントサイズ編集を開始' })).toHaveText('13');
  await page.keyboard.press('Escape');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const chartTop = await page.getByTestId('unified-canvas').evaluate(el => {
      const container = el.closest('div.fixed')!;
      const headerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-h'));
      return { top: container.getBoundingClientRect().top, headerHeight };
    });
    expect(chartTop.top).toBe(chartTop.headerHeight);
  }
  await page.goto('/budget-sankey?year=2024&ld=major');
  await expect(page).toHaveURL(/ld=major/);
});

test('public regex APIs reject unsafe syntax and remain responsive for nested repetition', async ({ request }) => {
  for (const path of ['/api/mof-hierarchy', '/api/mof-sankey']) {
    const bad = await request.get(path, { params: { year: '2024', filterSection: '(a)\\1', filterSectionRegex: '1' } });
    expect(bad.status()).toBe(400);
    const good = await request.get(path, { params: { year: '2024', filterSection: '^(a+)+$', filterSectionRegex: '1' }, timeout: 10000 });
    expect(good.ok()).toBe(true);
  }
});
