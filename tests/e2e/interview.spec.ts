import { expect, test, type Page } from '@playwright/test';
import { COMMENTS_DISABLED_REASON, COMMENTS_ENABLED } from './feature-env';

test.skip(!COMMENTS_ENABLED, COMMENTS_DISABLED_REASON);

async function openInterview(page: Page, llm = { calls: 0 }) {
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments: [], total: 0, nextCursor: null },
  }));
  // BYOK（キー入力から始まる）経路を固定する。環境にサイト提供 AI の設定があっても使わない
  await page.route('**/api/ai/interview', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 404, json: { error: 'disabled in test' } })
    : route.fallback());
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    llm.calls++;
    return route.fulfill({
      json: { choices: [{ message: { role: 'assistant', content: 'なぜ成果が気になりますか？' } }] },
    });
  });
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
  const llm = { calls: 0 };
  const dialog = await openInterview(page, llm);
  const key = dialog.getByLabel('APIキー', { exact: true });
  await key.click();
  await expect(dialog).toBeVisible();
  await expectSelection(page);
  await key.fill('test-only-key');
  await dialog.getByRole('button', { name: '保存して始める' }).click();
  const input = dialog.getByPlaceholder('ここに入力（Ctrl+Enter で送信）');
  await expect(input).toBeEnabled();
  // 冒頭の問いかけは定型文。開いただけでは LLM を呼ばない
  await expect(dialog.getByText(/「基礎年金給付に必要な経費」について、ご意見を聞かせてください。/)).toBeVisible();
  expect(llm.calls).toBe(0);
  await input.click();
  await input.fill('事業の成果を知りたいです');
  await dialog.getByRole('button', { name: '送信', exact: true }).click();
  await expect(dialog.getByText('事業の成果を知りたいです', { exact: true })).toBeVisible();
  await expect(dialog.getByText('なぜ成果が気になりますか？', { exact: true })).toBeVisible();
  expect(llm.calls).toBe(1);
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

test('site-provided AI mode shows the rule-based opening without calling the server LLM', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/projects/*/comments?*', route => route.fulfill({
    json: { comments: [], total: 0, nextCursor: null },
  }));
  await page.route('**/api/ai/interview', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    posts++;
    return route.fulfill({ json: { text: 'どの部分の金額が気になりますか？' } });
  });
  await page.goto('/budget-sankey?year=2024&sel=project-budget-2826');
  await page.getByRole('button', { name: '意見を伝える', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '意見インタビュー' });
  await expect(dialog.getByText(/「基礎年金給付に必要な経費」について、ご意見を聞かせてください。/)).toBeVisible();
  expect(posts).toBe(0);
  const input = dialog.getByPlaceholder('ここに入力（Ctrl+Enter で送信）');
  await input.fill('金額が大きいと思います');
  await dialog.getByRole('button', { name: '送信', exact: true }).click();
  await expect(dialog.getByText('どの部分の金額が気になりますか？', { exact: true })).toBeVisible();
  expect(posts).toBe(1);
});
