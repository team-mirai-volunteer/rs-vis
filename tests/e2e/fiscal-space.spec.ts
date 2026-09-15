import { test, expect } from '@playwright/test';

test('public investment shows commissioned benefits separately and overlap controls change GDP', async ({ page }) => {
  await page.goto('/fiscal-space');
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('10');
  const benefit = page.getByTestId('public-capital-benefit');
  await expect(benefit.locator('summary')).toContainText('0.25兆円');
  await expect(benefit).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('input-overview')).toContainText('-5.01兆円');
  await benefit.locator('summary').click();
  const detail = page.getByRole('region', { name: '公共投資の需要効果と供用後便益', exact: true });
  await expect(detail.getByRole('row').last()).toContainText('1.50兆円');
  await expect(detail.getByRole('row').last()).toContainText('-5.27兆円');
  await page.locator('summary').filter({ hasText: /^公共資本の蓄積/ }).click();
  const overlap = page.getByLabel('公共資本・公表反応との重複控除率', { exact: true });
  await overlap.fill('100');
  await expect(benefit.locator('summary')).toContainText('0.00兆円');
  await expect(page.getByTestId('input-overview')).toContainText('-5.27兆円');
  await overlap.fill('0');
  await expect(benefit.locator('summary')).toContainText('0.51兆円');
  await expect(page.getByTestId('input-overview')).toContainText('-4.76兆円');
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await expect(benefit.locator('summary')).toContainText('0.51兆円');
  await expect(page.getByTestId('input-overview')).toContainText('-4.76兆円');
});

test('example allocation displays pinned yen conversion and absolute search results', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await expect(page.getByText('税収弾性値 1.1・徴収ラグ 0年を仮定。', { exact: false })).toBeVisible();
  const result = page.getByTestId('horizon-results');
  await expect(result.getByRole('heading', { name: '5年目の結果（試算）' })).toBeVisible();
  await expect(result.locator('[data-metric="国民負担（GDP比）"]')).toContainText('31.01%');
  await page.getByRole('button', { name: '例：社会保険料減税中心の15兆円配分' }).click();
  await expect(page.getByTestId('annual-total')).toHaveText('15.0兆円');
  await expect(page.getByTestId('input-overview')).toContainText('15.00兆円 / 年');
  await expect(page.getByTestId('input-overview')).toContainText('追加予算');
  await expect(page.getByTestId('input-overview')).not.toContainText('入力額');
  await expect(result.locator('[data-metric="国民負担（GDP比）"]')).toContainText('30.41%');
  await expect(result.locator('[data-metric="国民負担（GDP比）"]')).toContainText('差 -0.604ポイント');
  await expect(result.locator('[data-metric="税・社会保険料収入"]')).toContainText('245.00兆円');
  await expect(result.locator('[data-metric="名目GDP"]')).toContainText('805.63兆円');
  const budget = page.getByTestId('input-overview').getByTestId('general-account-budget');
  await budget.getByText('一般会計の歳入・歳出内訳', { exact: true }).click();
  await expect(budget).toContainText('125.42兆円');
  await expect(budget).toContainText('一般歳出');
  await expect(budget).toContainText('73.27兆円');
  await expect(budget).toContainText('公債金');
  await expect(budget).toContainText('32.70兆円');
  await expect(budget).toContainText('2026年度・国の一般会計（補正後）');
  const headings = await page.locator('main h2').allTextContents();
  expect(headings.indexOf('追加予算と国の一般会計予算')).toBeLessThan(headings.indexOf('5年目の結果（試算）'));
  expect(headings.indexOf('5年目の結果（試算）')).toBeLessThan(headings.indexOf('次の1兆円で、どの制約が動く？'));
  const projectionTable = page.getByRole('region', { name: '5年間の推計表', exact: true });
  await expect(projectionTable.getByRole('columnheader', { name: '国民負担/GDP', exact: true })).toBeVisible();
  await expect(projectionTable.getByRole('row').last()).toContainText('30.41%');
  await expect(page.getByTestId('baseline-inflation-sensitivity')).toBeVisible();
  await expect(page.getByTestId('tax-elasticity-sensitivity')).toContainText('1.7');
  await expect(page.getByTestId('theoretical-maximum')).toHaveText('17.0兆円');
  await expect(page.getByTestId('input-overview').getByTestId('recommended-envelope')).toHaveText('17.0兆円 / 年');
  const sensitivity = page.getByTestId('cpi-limit-sensitivity');
  await expect(sensitivity.getByRole('row').filter({ hasText: '3.0%' })).toContainText('22.0兆円');
  await expect(sensitivity.getByRole('row').filter({ hasText: '3.5%' })).toContainText('22.0兆円');
});

test('insurance relief stops at contributor revenue and readjusts when the split changes', async ({ page }) => {
  await page.goto('/fiscal-space');
  const input = page.getByLabel('社会保険料減税・数値で入力', { exact: true });
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await input.fill('100');
  await expect(input).toHaveValue('78.7');
  await expect(page.getByTestId('input-overview')).toContainText('78.70兆円 / 年');
  await expect(page.locator('[data-policy="social-insurance"]')).toHaveCount(0);
  await page.getByText('乗数と本人・事業主の反応を変える', { exact: true }).click();
  await page.getByLabel('社会保険料軽減の本人配分・数値で入力', { exact: true }).fill('100');
  await expect(input).toHaveValue('43.6');
  await expect(page.getByTestId('annual-total')).toHaveText('43.6兆円');
  await expect(page.getByTestId('input-overview')).toContainText('43.60兆円 / 年');
});

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
  await expect(page.getByRole('region', { name: '負荷推計の感度表' })).toBeVisible();
  await expect(page.getByRole('meter', { name: '産業別能力の閾値利用率' })).toHaveCount(1);
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
  await expect(page.getByTestId('recommended-envelope')).not.toHaveText('0.0兆円 / 年');
  await expect(page.getByTestId('baseline-inflation-sensitivity')).toBeVisible();
  await expect(page.locator('[data-observation-key="fiscal.grossDebt"]')).toContainText('214.50%');
  await page.getByLabel('参照するマクロモデル').selectOption('esri2022');
  await expect(page.getByRole('region', { name: '3年間の推計表' })).toBeVisible();
  await expect(page.getByRole('region', { name: '5年間の推計表' })).toHaveCount(0);
  await expect(page.getByTestId('horizon-results').getByRole('heading')).toHaveText('3年目の結果（試算）');
  expect(errors).toEqual([]);
});

test('mobile controls stay near the top and an invalid shared URL is explained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fiscal-space#scenario=invalid');
  await expect(page.getByText('共有条件を復元できません。初期状態を表示しています。')).toBeVisible();
  const panel = page.getByRole('region', { name: '政策の操作パネル' });
  expect(await panel.evaluate(el => el.getBoundingClientRect().top + window.scrollY)).toBeLessThan(650);
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('10');
  await expect(page.getByTestId('input-overview')).toContainText('10.00兆円');
  await expect(page.getByRole('region', { name: '次の1兆円の政策比較表', exact: true })).toBeVisible();
  const projection = page.getByRole('region', { name: '5年間の推計表', exact: true });
  await expect(projection).toBeVisible();
  // Measure only after the worker results and both wide tables exist.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await projection.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => projection.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByTestId('budget-combined')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /5年推移/ })).toContainText('ここから先は仮定に基づく試算');
});

test('pending results are visible, data dialog is lazy, and tables remain keyboard accessible', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options) {
      setTimeout(() => post.call(this, message, options as StructuredSerializeOptions), 700);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await expect(page.locator('[data-source-key]')).toHaveCount(0);
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('10');
  await expect(page.getByTestId('calculation-status')).toContainText('結果は直前の条件');
  await expect(page.getByTestId('calculation-status').getByRole('status')).toBeVisible();
  await expect(page.getByTestId('input-overview')).toContainText('10.00兆円');
  await expect(page.getByTestId('calculation-status')).toBeEmpty();
  await expect(page.getByRole('region', { name: '結果を左右する前提' })).toContainText('評価期間中一定');
  await expect(page.locator('[data-constraint]').first()).toHaveAttribute('data-constraint', 'inflation');
  await expect(page.getByTestId('fiscal-vintage').first()).toContainText('分子2024年／分母2026Q2');
  await page.getByRole('button', { name: 'データについて', exact: true }).click();
  await expect(page.locator('[data-source-key]').first()).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-source-key]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'データについて', exact: true })).toBeFocused();
  // Exercise expanded detail tables, including those absent from the initial viewport.
  await page.locator('main details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
  const inaccessible = await page.locator('main table').evaluateAll(tables => tables.flatMap(table => {
    const wrapper = table.closest('[class*="overflow"]');
    if (!wrapper || wrapper.scrollWidth <= wrapper.clientWidth + 1) return [];
    return wrapper.getAttribute('tabindex') === '0' && wrapper.getAttribute('role') === 'region' && wrapper.getAttribute('aria-label')
      ? [] : [table.textContent?.slice(0, 70)];
  }));
  expect(inaccessible).toEqual([]);
  await expect(page.locator('main th:not([scope])')).toHaveCount(0);
  expect(await page.locator('main summary').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 24))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
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
  await expect(page.getByTestId('recommended-envelope')).toContainText('算出不可：負荷が未評価');
  const notes = page.getByTestId('input-overview').locator('details').filter({ has: page.getByText('計算上の注意', { exact: true }) });
  await expect(notes).not.toHaveAttribute('open', '');
  await expect(notes.getByText('産業別・電力の追加負荷に未評価の項目があります。')).not.toBeVisible();
  await notes.locator('summary').click();
  await expect(notes.getByText('産業別・電力の追加負荷に未評価の項目があります。')).toBeVisible();
  await notes.locator('summary').click();
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

test('stalled worker can be restarted without losing inputs and pending status reserves no space', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    let stalled = true;
    window.addEventListener('test-resume-worker', () => { stalled = false; });
    Worker.prototype.postMessage = function (message, options) {
      if (!stalled) post.call(this, message, options as StructuredSerializeOptions);
    };
  });
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('calculation-status').getByRole('status')).toBeVisible();
  const amount = page.getByLabel('公共投資・数値で入力', { exact: true });
  await amount.fill('7');
  const panel = page.getByRole('region', { name: '政策の操作パネル' });
  const top = await panel.evaluate(el => el.getBoundingClientRect().top + scrollY);
  expect(await page.getByTestId('calculation-status').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test-resume-worker')));
  await page.getByRole('button', { name: '計算をやり直す', exact: true }).click();
  await expect(page.getByTestId('input-overview')).toContainText('7.00兆円 / 年');
  await expect(page.getByTestId('calculation-status')).toBeEmpty();
  expect(await panel.evaluate(el => el.getBoundingClientRect().top + scrollY)).toBe(top);
});

test('unresponsive worker reaches a visible timeout and retries the latest form', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    let stalled = true;
    window.addEventListener('test-resume-worker', () => { stalled = false; });
    Worker.prototype.postMessage = function (message, options) {
      if (!stalled) post.call(this, message, options as StructuredSerializeOptions);
      else document.documentElement.dataset.testWorkerStalled = 'true';
    };
  });
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('calculation-status').getByRole('status')).toBeVisible();
  await page.clock.runFor(200);
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('9');
  // 初期化・入力の debounce 後に、実際に計算が始まってから監視時間を進める。
  await page.clock.runFor(200);
  await expect(page.locator('html')).toHaveAttribute('data-test-worker-stalled', 'true');
  await page.clock.fastForward(31_000);
  await expect(page.locator('main').getByRole('alert')).toContainText('計算の応答がないため停止しました');
  await expect(page.getByTestId('calculation-status')).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event('test-resume-worker')));
  await page.getByRole('button', { name: '計算を再試行', exact: true }).click();
  await page.clock.runFor(200);
  await expect(page.getByTestId('input-overview')).toContainText('9.00兆円 / 年');
});

test('large supply scenarios keep a bounded chart and subsequent edits work', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('100');
  await page.getByLabel('使用する生産モデル', { exact: true }).selectOption('cobbDouglas');
  await page.locator('summary').filter({ hasText: /^公共資本の蓄積/ }).click();
  await page.getByLabel('公共資本の蓄積・効果係数', { exact: true }).fill('1');
  await page.getByLabel('公共資本の蓄積・純追加性', { exact: true }).fill('100');
  await page.getByLabel('公共資本の蓄積・効果までの年数', { exact: true }).fill('0');
  await page.getByLabel('公共資本の蓄積・単位費用・基準資本比', { exact: true }).fill('0.01');
  await expect(page.getByTestId('calculation-status')).toBeEmpty();
  const chart = page.getByRole('img', { name: /5年推移/ });
  expect(await chart.locator('text').filter({ hasText: '兆円' }).count()).toBeLessThanOrEqual(9);
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('99');
  await expect(page.getByTestId('input-overview')).toContainText('99.00兆円 / 年');
});
