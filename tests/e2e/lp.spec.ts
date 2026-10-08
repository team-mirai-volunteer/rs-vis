import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`LP separates project and company search and retains question scripts (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/lp');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('国の予算は、ここまで見える。');
    await expect(page.getByRole('link', { name: '予算の流れを見てみる' }).first()).toHaveAttribute('href', /\/budget-sankey\?/);
    await expect(page.getByRole('link', { name: '事業を調べる', exact: true })).toHaveAttribute('href', '/quality');
    await expect(page.getByRole('link', { name: '企業・事業者を調べる', exact: true })).toHaveAttribute('href', '/vendors');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('link', { name: '企業・事業者を調べる', exact: true }).click();
    await expect(page).toHaveURL(/\/vendors$/);
    await page.getByRole('textbox', { name: '事業者名・法人番号で検索' }).fill('博報堂');
    await page.getByRole('textbox', { name: '事業者名・法人番号で検索' }).press('Enter');
    await expect(page.getByRole('table')).toContainText('株式会社博報堂');
    await page.goBack();
    // 検索時のURL変更にかかわらず、LPへ戻ってもう一方の導線も確かめる。
    if (!new URL(page.url()).pathname.endsWith('/lp')) await page.goto('/lp');
    await page.getByRole('link', { name: '事業を調べる', exact: true }).click();
    await expect(page).toHaveURL(/\/quality$/);
    await expect(page.getByRole('textbox', { name: '事業を検索', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '国会質問の設計（台本つき11本＋3本）' })).toBeVisible();
    await expect(page.locator('#questions li[id^="q-"]')).toHaveCount(14);
    const firstQuestion = page.locator('#q-1 details');
    await firstQuestion.locator('summary').click();
    await expect(firstQuestion.getByText('大臣への問い', { exact: true })).toBeVisible();
    await firstQuestion.locator('summary').click();
    await expect(firstQuestion.getByText('大臣への問い', { exact: true })).toBeHidden();
    await firstQuestion.locator('summary').click();
    await expect(firstQuestion.getByText('大臣への問い', { exact: true })).toBeVisible();
  });
}

test('LP key disclosures remain visible without opening an individual insight', async ({ page }) => {
  await page.goto('/lp');
  const bid = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'RSに記載された競争入札では、1者応札が48%' }) });
  await expect(bid).toContainText('応札者数の記載がある16,948件');
  await page.locator('#insights > div > details > summary').click();
  const broker = page.getByRole('article').filter({ has: page.getByRole('heading', { name: /事務局への支出は3,027億円/ }) });
  await expect(broker.getByText(/補助金本体を含む支出額で、事務局の手数料ではない/)).toBeVisible();
  const audit = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '外部の検査結果と、独自基準のAI評価を別々に確かめられる' }) });
  await expect(audit.getByText('91事業', { exact: true })).toBeVisible();
  await audit.locator('summary').click();
  await expect(audit.getByText(/人による確認は未実施/)).toBeVisible();
  await expect(page.getByText(/年金給付を含む事業もレビュー対象/)).toBeVisible();
  await expect(page.getByText(/政府の公式評価ではなく、人によるレビューも経ていません/)).toBeVisible();
});
