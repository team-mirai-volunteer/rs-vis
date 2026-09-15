import { expect, test } from '@playwright/test';

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

test('budget flow has a visible heading and starts with reduced labels', async ({ page }) => {
  await page.goto('/budget-sankey?year=2024');
  await expect(page.getByRole('heading', { level: 1, name: '国の予算と支出の流れ' })).toBeVisible();
  await expect(page.getByText('左から右へ、お金の流れをたどれます。', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/ld=major/);
  await expect(page.getByTestId('unified-canvas')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
});

test('public regex APIs reject unsafe syntax and remain responsive for nested repetition', async ({ request }) => {
  for (const path of ['/api/mof-hierarchy', '/api/mof-sankey']) {
    const bad = await request.get(path, { params: { year: '2024', filterSection: '(a)\\1', filterSectionRegex: '1' } });
    expect(bad.status()).toBe(400);
    const good = await request.get(path, { params: { year: '2024', filterSection: '^(a+)+$', filterSectionRegex: '1' }, timeout: 10000 });
    expect(good.ok()).toBe(true);
  }
});
