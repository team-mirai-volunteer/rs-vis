import { expect, test, type Page } from '@playwright/test';

async function openInterview(page: Page) {
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments: [], total: 0, nextCursor: null },
  }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({
    json: { choices: [{ message: { role: 'assistant', content: 'この事業についてどう思いますか？' } }] },
  }));
  await page.goto('/budget-sankey?year=2024&sel=project-budget-2826');
  await page.getByRole('button', { name: '意見を伝える', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '意見インタビュー' });
  await expect(dialog.getByLabel('APIキー', { exact: true })).toBeVisible();
  return dialog;
}

async function expectSelection(page: Page) {
  await expect(page).toHaveURL(/sel=project-budget-2826/);
  await expect(page.getByTestId('unified-side-panel').getByText('基礎年金給付に必要な経費').first()).toBeVisible();
}

test('interview clicks and typing preserve the selected project', async ({ page }) => {
  const dialog = await openInterview(page);
  const key = dialog.getByLabel('APIキー', { exact: true });
  await key.click();
  await expect(dialog).toBeVisible();
  await expectSelection(page);
  await key.fill('test-only-key');
  await dialog.getByRole('button', { name: '保存して始める' }).click();
  const input = dialog.getByPlaceholder('ここに入力（Ctrl+Enter で送信）');
  await expect(input).toBeEnabled();
  await input.click();
  await input.fill('事業の成果を知りたいです');
  await dialog.getByRole('button', { name: '送信', exact: true }).click();
  await expect(dialog.getByText('事業の成果を知りたいです', { exact: true })).toBeVisible();
  await expectSelection(page);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expectSelection(page);
});

test('Escape and backdrop dismiss only the interview', async ({ page }) => {
  let dialog = await openInterview(page);
  await dialog.getByLabel('APIキー', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expectSelection(page);
  await page.getByRole('button', { name: '意見を伝える', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '意見インタビュー' });
  await expect(dialog).toBeVisible();
  // 背面がヘッダーでなく、選択解除ハンドラのある図になる位置。
  await page.mouse.click(5, 300);
  await expect(dialog).toHaveCount(0);
  await expectSelection(page);
});
