import { expect, test, type Page } from '@playwright/test';
import { budgetRequestResponse, parseBudgetRequestFilters } from '../../app/lib/budget-requests';
import { requestDataset } from '../fixtures/budget-requests-ui';

async function mockDataset(page: Page, retained = false) {
  const dataset = requestDataset();
  if (retained) dataset.documents[0].status = 'fetch_failed';
  await page.route('**/api/budget-requests*', route => route.fulfill({ json: budgetRequestResponse(dataset, parseBudgetRequestFilters(new URL(route.request().url()).searchParams)) }));
}

for (const width of [1440, 390]) {
  test(`概算要求を絞り込み、原文・失敗資料を確認して戻れる（${width}px）`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await mockDataset(page);
    await page.goto('/budget-requests?limit=1');
    await expect(page).toHaveTitle('概算要求（試作）｜行政事業レビュー可視化');
    await expect(page.getByRole('heading', { name: '概算要求を原資料から探す' })).toBeVisible();
    const record = page.getByTestId('request-record');
    await expect(record).toHaveCount(1);
    for (const label of ['府省・機関等', '取得状況', '資料種別', '記載のある金額区分']) {
      await expect(page.getByRole('combobox', { name: label, exact: true })).toBeVisible();
    }
    await expect(record).toContainText('0円');
    await expect(record).toContainText('事項要求（金額未定）');
    await expect(record).toContainText('記載なし');
    await record.getByText('原文・抽出根拠を見る', { exact: true }).click();
    await expect(record).toContainText('テスト研究推進事業 0 事項要求');
    await expect(record.getByRole('link', { name: '原資料を開く' })).toHaveAttribute('href', 'https://example.go.jp/test.pdf#page=3');
    await expect(record).toContainText('test-hash');
    await record.getByText('原文・抽出根拠を見る', { exact: true }).click();
    await expect(record.getByText('テスト研究推進事業 0 事項要求', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: '次のページ', exact: true }).click();
    await expect(record).toContainText('テスト整備事業');
    await expect(record).toContainText('抽出できず');
    await page.goBack();
    await expect(record).toContainText('テスト研究推進事業');
    await page.getByLabel('記載のある金額区分').selectOption('specialInvestment');
    await expect(record).toContainText('120,000,000円');
    await page.getByRole('button', { name: '条件をクリア' }).click();
    await page.getByRole('searchbox', { name: '事業名・資料名を検索' }).fill('研究');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(record).toHaveCount(1);
    await expect(record).toContainText('テスト研究推進事業');
    await page.reload();
    await expect(page.getByRole('searchbox')).toHaveValue('研究');
    await expect(record).toHaveCount(1);
    await page.getByRole('button', { name: '条件をクリア' }).click();
    await page.getByLabel('府省・機関等', { exact: true }).selectOption('別省');
    await expect(page.getByRole('combobox', { name: '府省・機関等', exact: true })).toHaveValue('別省');
    await expect(page.getByText('条件に一致する抽出済みの行はありません。')).toBeVisible();
    await page.getByRole('button', { name: /^資料と取得状況/ }).click();
    await page.getByLabel('取得状況', { exact: true }).selectOption('fetch_failed');
    const documentCard = page.getByTestId('request-document');
    await expect(documentCard).toHaveCount(1);
    await expect(documentCard).toContainText('テスト用取得失敗');
    await documentCard.getByText('取得履歴と出典', { exact: true }).click();
    await expect(documentCard).toContainText('最終試行日時');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/budget-requests-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('欠落データ・通信失敗は0件と混同せず、再試行できる', async ({ page }) => {
  let state: 'missing' | 'error' | 'ok' = 'missing';
  await page.route('**/api/budget-requests*', route => state === 'ok'
    ? route.fulfill({ json: budgetRequestResponse(requestDataset(), parseBudgetRequestFilters(new URLSearchParams())) })
    : route.fulfill({ status: state === 'missing' ? 404 : 500, json: { error: state === 'missing' ? 'missing' : 'テスト通信失敗' } }));
  await page.goto('/budget-requests');
  await expect(page.getByText('2027年度の概算要求データはまだ取得されていません。')).toBeVisible();
  await expect(page.getByTestId('request-record')).toHaveCount(0);
  state = 'error';
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByRole('region', { name: '概算要求の検索結果' }).getByRole('alert')).toContainText('テスト通信失敗');
  state = 'ok';
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByTestId('request-record')).toHaveCount(2);
});

test('取得失敗時に残した行は過去の取得時点と明示する', async ({ page }) => {
  await mockDataset(page, true);
  await page.goto('/budget-requests');
  await expect(page.getByTestId('request-record').first()).toContainText('以下は過去の取得時点');
  await page.getByRole('button', { name: /^資料と取得状況/ }).click();
  await expect(page.getByTestId('request-document').first()).toContainText('最新資料の確認はできていません');
});

test('概算要求の公開メタ情報と共有画像をJavaScriptなしで読める', async ({ request }) => {
  const response = await request.get('/budget-requests');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<title>概算要求（試作）｜行政事業レビュー可視化</title>');
  expect(html).toContain('概算要求を原資料から探す');
  const image = await request.get('/og/budget-requests.png');
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toContain('image/png');
  const bytes = await image.body();
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
});
