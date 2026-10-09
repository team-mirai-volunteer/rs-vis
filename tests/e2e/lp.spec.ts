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
    // 評価一覧はPCの表とスマホのカードで検索欄の表示が異なる。
    const projectSearch = width < 640
      ? page.getByRole('textbox', { name: '事業を検索', exact: true })
      : page.getByPlaceholder('事業名・PID・組織名で検索...');
    await expect(projectSearch).toBeVisible();
    await projectSearch.fill('6494');
    await expect(projectSearch).toHaveValue('6494');
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

for (const width of [1440, 390]) {
  test(`LP model cases disclose evidence limits and open the correct records (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/lp');
    const news = page.locator('#budget-news');
    await expect(news).toContainText('内閣官房・内閣広報室の2027年度概算要求は72.3億円');
    await expect(news.getByText(/2027年度の概算要求全体は未収録/)).toBeVisible();
    await expect(news.getByRole('link', { name: 'FNNの報道を読む' })).toHaveAttribute('href', 'https://www.fnn.jp/articles/-/1112462');
    await news.locator('summary').click();
    await expect(news.getByText(/今回の要求との対応関係は、別途確認が必要/)).toBeVisible();

    const support = page.locator('#support-case');
    await expect(support.getByText(/執行率だけでは支援の過不足は分かりません/)).toBeVisible();
    await support.locator('summary').click();
    await expect(support.getByRole('heading', { name: '国会で確かめる問い（試案）' })).toBeVisible();
    await expect(support.getByText(/要件を満たした学校施設整備の申請/)).toBeVisible();
    await support.locator('summary').click();
    await expect(support.getByRole('heading', { name: '国会で確かめる問い（試案）' })).toBeHidden();
    await support.locator('summary').click();
    await expect(support.getByRole('heading', { name: '国会で確かめる問い（試案）' })).toBeVisible();
    await expect(page.locator('#investigation-case ol > li')).toHaveCount(5);
    await expect(page.locator('#investigation-case')).toContainText('2023・2025年度にあります（2025年度は暫定）');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await support.getByRole('link', { name: '学校施設整備の事業詳細を開く' }).click();
    await expect(page).toHaveURL(/\/quality\?fiscalYear=2024&detail=1527$/);
    const detail = page.getByRole('dialog', { name: '公立学校施設整備費 の詳細', exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.getByText('PID 1527', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/lp$/);
    await page.locator('#investigation-case').getByRole('link', { name: '事業者の年度別の記載を開く' }).click();
    await expect(page).toHaveURL(/\/vendors\?.*vendor=1020001071491/);
    const vendor = page.getByRole('complementary', { name: '富士通株式会社 の詳細', exact: true });
    // 支出先プロフィール内の同名事業ではなく、直下の1者応札リストを検証する。
    const projectRecord = vendor.locator(':scope > ul > li').filter({ hasText: 'ハローワークシステム運営費' });
    await expect(projectRecord).toHaveCount(1);
    await expect(projectRecord).toContainText('2023年度・2025年度に1者応札');
    await page.goBack();
    await expect(page).toHaveURL(/\/lp$/);
    await expect(page.locator('#questions li[id^="q-"]')).toHaveCount(14);
  });
}
