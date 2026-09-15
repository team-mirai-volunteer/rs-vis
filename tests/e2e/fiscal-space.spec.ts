import { test, expect } from '@playwright/test';

test('neutral input, editable amounts, model conditions and shared URL restore the same result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/fiscal-space');
  await page.waitForFunction(() => {
    const fields = [...document.querySelectorAll('main input')];
    return fields.length > 0 && fields.every(el => Object.keys(el).some(k => k.startsWith('__reactProps$')));
  });
  await expect(page).toHaveTitle(/財政余力シミュレータ/);
  await expect(page.getByTestId('annual-total')).toHaveText('0.0兆円');
  const amount = page.getByLabel('公共投資・数値で入力', { exact: true });
  await amount.fill('');
  await expect(amount).toHaveValue('');
  await amount.fill('10');
  await expect(page.getByTestId('input-overview')).toContainText('10.00兆円');
  await expect(page.getByTestId('input-overview')).toContainText('政策なし経路を下回ります');
  await expect(page.getByTestId('cpi-decomposition')).toBeVisible();
  await expect(page.getByRole('meter', { name: '産業別能力の閾値利用率' })).toHaveCount(0);
  // Consecutive edits must read immediate form state, not the debounced result.
  const planned = page.getByLabel('既定計画の非化石発電の年間追加量', { exact: true });
  const demand = page.getByLabel('共通の電力需要増加率', { exact: true });
  await planned.fill('10');
  await demand.fill('1');
  await expect(planned).toHaveValue('10');
  await expect(demand).toHaveValue('1');
  await expect(page.getByText('入力を反映しています。結果は直前の条件です。')).toHaveCount(0);
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  await expect(page.getByLabel('共有URL', { exact: true })).toHaveValue(/#scenario=/);
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  const before = await page.getByTestId('input-overview').innerText();
  await page.goto(url);
  await expect.poll(() => page.getByTestId('input-overview').innerText()).toEqual(before);
  await expect(planned).toHaveValue('10');
  await expect(demand).toHaveValue('1');
  await page.getByRole('radio', { name: '2024年で揃える' }).check();
  await expect(amount).toHaveValue('10');
  await expect(page.getByText('政策なしでも設定した上限を超えます。', { exact: false })).toBeVisible();
  await expect(page.locator('[data-observation-key="fiscal.grossDebt"]')).toContainText('214.50%');
  await page.getByLabel('参照するマクロモデル').selectOption('esri2022');
  await expect(page.getByRole('region', { name: '3年間の推計表' })).toBeVisible();
  await expect(page.getByRole('region', { name: '5年間の推計表' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mobile controls stay near the top and an invalid shared URL is explained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fiscal-space#scenario=invalid');
  await expect(page.getByText('共有条件を復元できません。初期状態を表示しています。')).toBeVisible();
  const panel = page.getByRole('region', { name: '政策の操作パネル' });
  expect(await panel.evaluate(el => el.getBoundingClientRect().top + window.scrollY)).toBeLessThan(650);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByTestId('budget-combined')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /5年推移/ })).toContainText('ここから先は仮定に基づく試算');
});

test('worker calculation keeps partial loads unevaluated and restores project conversions from the URL', async ({ page }) => {
  if (process.env.FISCAL_WORKER_CSP_SELF === '1') {
    await page.route('**/fiscal-space', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "worker-src 'self'" } });
    });
  }
  const workerStarted = page.waitForEvent('worker');
  await page.goto('/fiscal-space');
  const worker = await workerStarted;
  expect(worker.url()).toContain(new URL(page.url()).origin);
  await expect(page.getByTestId('input-overview')).toBeVisible();
  const amount = page.getByLabel('公共投資・数値で入力', { exact: true });
  for (const value of ['1', '4', '8', '2']) await amount.fill(value);
  await expect(page.getByTestId('input-overview')).toContainText('2.00兆円 / 年');
  const loads = page.getByRole('region', { name: '政策別の負荷条件', exact: true });
  await loads.locator('summary').click();
  await loads.getByLabel('公共投資の負荷条件を入力する').check();
  const sectorMeter = page.getByRole('meter', { name: '産業別能力の閾値利用率' });
  const energyMeter = page.getByRole('meter', { name: '電力供給能力の閾値利用率' });
  await expect(sectorMeter).toHaveCount(0);
  await expect(energyMeter).toHaveCount(0);
  await loads.getByLabel(/公共投資・支出1兆円の産業稼働率増分/).fill('0');
  await expect(sectorMeter).toHaveCount(1);
  await expect(energyMeter).toHaveCount(0);
  await loads.getByLabel('公共投資・負荷の入力方式').selectOption('project');
  await expect(sectorMeter).toHaveCount(0);
  await loads.getByLabel(/公共投資・稼働後の年間電力（ピーク不明時）/).fill('8760');
  const conversion = page.getByTestId('load-conversion-public-investment');
  await expect(conversion).toContainText('稼働後ピーク 未評価');
  await loads.getByLabel(/公共投資・年間負荷率/).fill('0.5');
  await loads.getByLabel(/公共投資・系統ピークとの同時発生係数/).fill('0.75');
  await expect(conversion).toContainText('稼働後ピーク 0.750GW');
  await expect(energyMeter).toHaveCount(0);
  await loads.getByLabel(/公共投資・支出年の追加ピーク電力/).fill('0');
  await expect(energyMeter).toHaveCount(1);
  await loads.getByLabel(/公共投資・稼働後の系統ピークへの純追加電力/).fill('400');
  await expect(conversion).toContainText('稼働後ピーク 0.200GW');
  await expect(page.getByRole('region', { name: '政策期間の比較', exact: true })).toContainText('同額予算での比較ではありません');
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await expect(page.getByTestId('input-overview')).toContainText('2.00兆円 / 年');
  await loads.locator('summary').click();
  await expect(conversion).toContainText('稼働後ピーク 0.200GW');
  await expect(energyMeter).toHaveCount(1);
  await expect(sectorMeter).toHaveCount(0);
});

test('worker startup failure leaves inputs usable and retry calculates the edited form', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.addEventListener('test-enable-worker', () => { window.Worker = NativeWorker; });
    window.Worker = new Proxy(NativeWorker, { construct() { throw new Error('Test startup failure'); } });
  });
  await page.goto('/fiscal-space');
  await expect(page.locator('main').getByRole('alert')).toContainText('計算を読み込めませんでした');
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('7');
  await page.evaluate(() => window.dispatchEvent(new Event('test-enable-worker')));
  await page.getByRole('button', { name: '計算を再試行' }).click();
  await expect(page.getByTestId('input-overview')).toContainText('7.00兆円 / 年');
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
});
