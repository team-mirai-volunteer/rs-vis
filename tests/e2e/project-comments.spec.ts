import { expect, test } from '@playwright/test';
import { COMMENTS_DISABLED_REASON, COMMENTS_ENABLED } from './feature-env';

test.skip(!COMMENTS_ENABLED, COMMENTS_DISABLED_REASON);

const comments = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`, body: `意見その${i + 1}`, createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
}));

test('みんなの意見 is collapsed by default and opens as an accordion', async ({ page }) => {
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments, total: comments.length, nextCursor: null },
  }));
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
  await panel.getByRole('button', { name: 'すべて表示（5件）' }).click();
  await expect(panel.getByText('意見その5', { exact: true })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByText('意見その1', { exact: true })).toHaveCount(0);
});

test('zero comments show the invitation without an accordion toggle', async ({ page }) => {
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments: [], total: 0, nextCursor: null },
  }));
  await page.goto('/budget-sankey?year=2024&sel=project-budget-2826');
  const panel = page.getByTestId('unified-side-panel');
  await expect(panel.getByText('まだ意見はありません。最初の意見を伝えてみませんか。')).toBeVisible();
  await expect(panel.getByRole('button', { name: /みんなの意見/ })).toHaveCount(0);
});
