import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments: [], total: 0, nextCursor: null },
  }));
});

test('opening, copying, reloading and navigating history preserve the selected detail', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/quality?year=2025&pid=1503#list');
  const search = page.getByPlaceholder('事業名・PID・組織名で検索...');
  await expect(search).toHaveValue('1503');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: 'GIGA' }).getByRole('button', { name: '詳細', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /GIGA.*の詳細/ });
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/year=2025&pid=1503&detail=1503#list$/);
  await detail.getByRole('button', { name: '詳細URLをコピー', exact: true }).click();
  await expect(detail.getByRole('status')).toHaveText('詳細URLをコピーしました');
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(shareUrl).pathname + new URL(shareUrl).search).toBe('/quality?year=2025&detail=1503');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(search).toHaveValue('1503');
  await page.goForward();
  await expect(detail).toBeVisible();
  await page.reload();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/year=2025&pid=1503#list$/);
  await page.goto(shareUrl);
  await expect(detail).toBeVisible();
});

for (const [year, pid] of [['2024', '2826'], ['2025', '1503'], ['2026', '1503']]) {
  test(`shared detail opens for ${year} without changing its year`, async ({ page }) => {
    const badResponses: string[] = [];
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) badResponses.push(response.url());
    });
    await page.goto(`/quality?year=${year}&detail=${pid}`);
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(`PID ${pid}`, { exact: true })).toBeVisible();
    if (year === '2026') await expect(detail.getByText(/2026年度は予算要求の表示です。以下の事業概要/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`year=${year}&detail=${pid}$`));
    await detail.getByRole('button', { name: '閉じる（Esc）', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`year=${year}$`));
    expect(badResponses).toEqual([]);
  });
}

test('clipboard failure leaves a selectable share URL and unknown detail can return to the list', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('unavailable'); } } });
  });
  await page.goto('/quality?year=2026&detail=1503');
  const detail = page.getByRole('dialog');
  await detail.getByRole('button', { name: '詳細URLをコピー', exact: true }).click();
  const fallback = detail.getByLabel('事業詳細の共有URL');
  await expect(fallback).toHaveValue(/\/quality\?year=2026&detail=1503$/);
  await fallback.focus();
  expect(await fallback.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBe((await fallback.inputValue()).length);
  await page.goto('/quality?year=2026&detail=999999999');
  await expect(page.getByRole('status')).toContainText('指定された事業（PID 999999999）は見つかりませんでした');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '一覧に戻る', exact: true }).click();
  await expect(page).toHaveURL(/year=2026$/);
  await expect(page.getByPlaceholder('事業名・PID・組織名で検索...')).toBeVisible();
});

test('history across years restores the detail from the correct dataset', async ({ page }) => {
  await page.goto('/quality?year=2026&detail=1503');
  await expect(page.getByRole('dialog')).toContainText('2026年度は予算要求の表示です');
  await page.keyboard.press('Escape');
  await page.getByLabel('年度', { exact: true }).selectOption('2024');
  await expect(page.getByLabel('年度', { exact: true })).toHaveValue('2024');
  await page.getByPlaceholder('事業名・PID・組織名で検索...').fill('2826');
  await page.getByRole('row').filter({ hasText: '基礎年金' }).getByRole('button', { name: '詳細', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('PID 2826');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel('年度', { exact: true })).toHaveValue('2026');
  await page.goBack();
  await expect(page.getByRole('dialog')).toContainText('PID 1503');
  await expect(page.getByRole('dialog')).toContainText('2026年度は予算要求の表示です');
  await expect(page.getByPlaceholder('事業名・PID・組織名で検索...')).toHaveValue('2826');
});
