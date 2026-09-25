import { expect, test, type Page } from '@playwright/test';
import { COMMENTS_DISABLED_REASON, COMMENTS_ENABLED } from './feature-env';

async function openQualityDetail(page: Page, year: string) {
  await page.goto(`/quality?year=${year}`);
  await page.getByPlaceholder('事業名・PID・組織名で検索...').fill('1503');
  await page.getByRole('row').filter({ hasText: 'GIGA' }).getByRole('button', { name: '詳細', exact: true }).click();
  return page.getByRole('dialog');
}

test('request-year details show unrecorded execution without requesting nonexistent RS data', async ({ page }) => {
  const requests: string[] = [];
  const failures: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/')) failures.push(response.url()); });
  const detail = await openQualityDetail(page, '2026');
  await expect(detail.getByText('2026年度は予算要求の表示です。以下の事業概要・評価は2025年度RSシートを参照しています。2026年度の支出先・執行実績は未収録です。')).toBeVisible();
  await expect.poll(() => requests.some(url => url.includes('/api/project-details/1503?year=2025'))).toBe(true);
  await expect(detail.getByText(/2026年度の支出先・執行実績は未収録です。予算要求の段階/)).toBeVisible();
  await expect(detail.getByRole('button', { name: '意見を伝える', exact: true })).toHaveCount(0);
  await expect(detail).not.toContainText('python3');
  await expect(detail).not.toContainText('HTTP 400');
  expect(requests.filter(url => url.includes('/comments') || url.includes('/quality-scores/recipients'))).toEqual([]);
  expect(failures).toEqual([]);
});

test('recorded-year comments distinguish a failed fetch from zero comments and can retry', async ({ page }) => {
  test.skip(!COMMENTS_ENABLED, COMMENTS_DISABLED_REASON);
  let attempts = 0;
  await page.route('**/api/projects/1503/comments?*', route => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 400, json: { error: 'test failure' } })
      : route.fulfill({ json: { comments: [], total: 0, nextCursor: null } });
  });
  const detail = await openQualityDetail(page, '2025');
  await expect(detail.getByText('件数を取得できません', { exact: true })).toBeVisible();
  await expect(detail.getByText('0件', { exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '再読み込みする', exact: true }).click();
  await expect(detail.getByText('まだ意見はありません。最初の意見を伝えてみませんか。')).toBeVisible();
  await expect(detail.getByText('0件', { exact: true })).toBeVisible();
  await expect(detail.getByText('件数を取得できません', { exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('quality scores failure shows a visitor-facing message and retries in place', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/quality-scores?*', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 500, body: 'boom' }) : route.continue();
  });
  await page.goto('/quality?year=2024');
  const alert = page.getByRole('alert').filter({ hasText: '評価データを読み込めませんでした' });
  await expect(alert).toBeVisible();
  await expect(page.locator('body')).not.toContainText('python3');
  await alert.getByRole('button', { name: '再読み込みする', exact: true }).click();
  await expect(page.getByRole('heading', { name: '事業別 政策評価・執行透明性スコア' })).toBeVisible();
  expect(attempts).toBe(2);
});
