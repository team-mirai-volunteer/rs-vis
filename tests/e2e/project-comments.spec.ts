import { expect, test } from '@playwright/test';
import { COMMENTS_DISABLED_REASON, COMMENTS_ENABLED } from './feature-env';

test.skip(!COMMENTS_ENABLED, COMMENTS_DISABLED_REASON);

// 意見は事業ID単位で年度をまたぐ。year は投稿時に見ていた RS シート年度（2024 = 2023年度）
const comments = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`, body: `意見その${i + 1}`, createdAt: new Date(Date.now() - i * 3_600_000).toISOString(), year: i === 0 ? 2024 : 2025,
}));

test('みんなの意見 is collapsed by default and opens as an accordion', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/api/projects/*/comments?*', route => {
    requested.push(route.request().url());
    return route.fulfill({ json: { comments, total: comments.length, nextCursor: null } });
  });
  await page.goto('/budget-sankey?year=2024&sel=project-budget-2826');
  const panel = page.getByTestId('unified-side-panel');
  const toggle = panel.getByRole('button', { name: /みんなの意見\s*5件/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByText('意見その1', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '意見を伝える', exact: true })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('意見その1', { exact: true })).toBeVisible();
  await expect(panel.getByText('意見その4', { exact: true })).toHaveCount(0);
  // 別年度に投稿された意見も同じ事業としてまとまり、投稿時の年度が添えられる
  await expect(panel.getByText('2023年度 ・', { exact: false }).first()).toBeVisible();
  await expect(panel.getByText('2024年度 ・', { exact: false }).first()).toBeVisible();
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every(url => !new URL(url).searchParams.has('year'))).toBe(true);
  await panel.getByRole('button', { name: 'すべて表示（5件）' }).click();
  await expect(panel.getByText('意見その5', { exact: true })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByText('意見その1', { exact: true })).toHaveCount(0);
});

test('zero comments add no extra line and no accordion toggle', async ({ page }) => {
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments: [], total: 0, nextCursor: null },
  }));
  await page.goto('/budget-sankey?year=2024&sel=project-budget-2826');
  const panel = page.getByTestId('unified-side-panel');
  await expect(panel.getByText('0件', { exact: true })).toBeVisible();
  await expect(panel.getByText(/まだ意見はありません/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '意見を伝える', exact: true })).toHaveAttribute('title', /まだ意見はありません/);
  await expect(panel.getByRole('button', { name: /みんなの意見/ })).toHaveCount(0);
});
