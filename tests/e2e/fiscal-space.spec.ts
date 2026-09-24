import { decodeSharedScenario } from '../../client/lib/fiscal-space-share';
import { calibratedEducationGain } from '../../app/lib/fiscal-space/education-response';
import { test, expect, type Page } from '@playwright/test';

/** 「詳細な条件」は開閉状態を localStorage に保存し、既定は閉じている。 */
const openAdvanced = (page: Page) => page.evaluate(() => {
  const summary = [...document.querySelectorAll('summary')].find(s => s.textContent?.trim() === '詳細な条件');
  const details = summary?.closest('details');
  if (details && !details.open) details.open = true;
});

test('insurance incidence and macro tail controls are editable and shared, including legacy mode', async ({ page }) => {
  const openConditions = async () => {
    await openAdvanced(page);
    await page.getByRole('button', { name: '乗数・税収・労働反応の条件', exact: true }).click();
  };
  await page.goto('/fiscal-space');
  await openConditions();
  const wage = page.getByLabel('事業主軽減の賃金転嫁率・数値で入力', { exact: true });
  const tail = page.getByLabel('公表期間後のマクロ反応解消年数・数値で入力', { exact: true });
  await expect(wage).toHaveValue('50');
  await expect(tail).toHaveValue('5');
  await page.getByRole('button', { name: '社保：慎重', exact: true }).click();
  await expect(wage).toHaveValue('25');
  await tail.fill('10');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'この条件のURLをコピー', exact: true }).click();
  const shared = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(shared);
  await openConditions();
  await expect(wage).toHaveValue('25');
  await expect(tail).toHaveValue('10');
  const old = new URL(shared);
  const payload = { version: '', form: (await decodeSharedScenario(old.hash)).form };
  payload.version = '2026-09-24.4';
  delete payload.form.calibration.insurance; delete payload.form.calibration.macroTailYears;
  old.hash = '#scenario=' + encodeURIComponent(JSON.stringify(payload));
  await page.goto(old.href); await page.reload();
  await expect(page.getByTestId('restore-notice')).toContainText('据置');
  await openConditions();
  await expect(page.getByLabel('賃金転嫁と長期労働反応を計算する', { exact: true })).not.toBeChecked();
  await expect(tail).toHaveValue('0');
});

test('OECD education defaults disclose calibrated gains, share targeted settings and retain legacy inputs', async ({ page }) => {
  const openEducation = async () => {
    await openAdvanced(page);
    await page.getByRole('button', { name: '政策別の供給力・長期条件', exact: true }).click();
    await page.locator('summary').filter({ hasText: /^教育の追加支出・学力改善|^旧方式：追加就学/ }).click();
  };
  await page.goto('/fiscal-space');
  await openEducation();
  const settings = page.getByTestId('education-supply-settings');
  const gain = page.getByLabel('教育・施策を継続した場合の全国平均PISA改善上限', { exact: true });
  await expect(settings).toContainText('日本へ50%移転');
  await expect(gain).toHaveValue(String(calibratedEducationGain(.5)));
  await settings.getByRole('button', { name: '慎重（移転25%）', exact: true }).click();
  await expect(gain).toHaveValue(String(calibratedEducationGain(.25)));
  await settings.getByRole('button', { name: '効果ゼロ', exact: true }).click();
  await expect(gain).toHaveValue('0');
  await expect(settings).toContainText('生産性の上乗せを未算入');
  await gain.fill('4');
  await expect(settings).toContainText('条件付きシナリオ');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'この条件のURLをコピー', exact: true }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await openEducation();
  await expect(gain).toHaveValue('4');
  const oldUrl = new URL(url);
  const payload = { version: '', form: (await decodeSharedScenario(oldUrl.hash)).form };
  payload.version = '2026-09-24.2';
  payload.form.supply.education = { kind: 'education', additionality: .5, lag: 4, depreciation: .02, lifetime: 35, yield: .09, unitCost: 1.5e6, employment: .8 };
  oldUrl.hash = '#scenario=' + encodeURIComponent(JSON.stringify(payload));
  await page.goto(oldUrl.href);
  await page.reload();
  await expect(page.getByTestId('restore-notice')).toContainText('旧就学年数方式');
  await openEducation();
  await expect(page.getByLabel('旧方式：追加就学・職業訓練・効果係数', { exact: true })).toHaveValue('0.09');
  await page.getByRole('button', { name: '教育をOECDの追加支出方式に切り替える', exact: true }).click();
  await expect(gain).toHaveValue(String(calibratedEducationGain(.5)));
  await expect(settings).toContainText('日本へ50%移転');
});

test('public investment shows commissioned benefits separately and overlap controls change GDP', async ({ page }) => {
  await page.goto('/fiscal-space');
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('10');
  const benefit = page.getByTestId('public-capital-benefit');
  await expect(benefit.locator('summary')).toContainText('0.25兆円');
  await expect(benefit).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('input-overview')).toContainText('-5.02兆円');
  await benefit.locator('summary').click();
  const detail = page.getByRole('region', { name: '公共投資の需要効果と供用後便益', exact: true });
  await expect(detail.getByRole('row').last()).toContainText('1.48兆円');
  await expect(detail.getByRole('row').last()).toContainText('-5.27兆円');
  await openAdvanced(page);
  await page.getByRole('button', { name: '政策別の供給力・長期条件', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^公共資本の蓄積/ }).click();
  const overlap = page.getByLabel('公共資本・公表反応との重複控除率', { exact: true });
  await overlap.fill('100');
  await expect(benefit.locator('summary')).toContainText('0.00兆円');
  await expect(page.getByTestId('input-overview')).toContainText('-5.27兆円');
  await overlap.fill('0');
  await expect(benefit.locator('summary')).toContainText('0.50兆円');
  await expect(page.getByTestId('input-overview')).toContainText('-4.77兆円');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await expect(benefit.locator('summary')).toContainText('0.50兆円');
  await expect(page.getByTestId('input-overview')).toContainText('-4.77兆円');
});

test('example allocation displays pinned yen conversion and absolute search results', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('input-overview')).toBeVisible();
  const result = page.getByTestId('horizon-results');
  await expect(result.getByRole('heading', { name: '5年目の結果（試算）' })).toBeVisible();
  // 2026-09-17.1: latest fiscal aggregates bridged with IMF 2026 ratios (taxes 19.8% + contributions 13.1% at year 0).
  await expect(result.locator('[data-metric="国民負担（GDP比）"]')).toContainText('33.71%');
  await page.getByRole('button', { name: '例：社会保険料減税だけで15兆円' }).click();
  await expect(page.getByTestId('annual-total')).toHaveText('15.0兆円');
  await expect(page.getByTestId('input-overview')).toContainText('15.00兆円 / 年');
  await expect(page.getByTestId('input-overview')).toContainText('追加予算');
  await expect(page.getByTestId('input-overview')).not.toContainText('入力額');
  await expect(result.locator('[data-metric="国民負担（GDP比）"]')).toContainText('31.95%');
  await expect(result.locator('[data-metric="国民負担（GDP比）"]')).toContainText('差 -1.763ポイント');
  await expect(result.locator('[data-metric="税・社会保険料収入"]')).toContainText('256.18兆円');
  await expect(result.locator('[data-metric="名目GDP"]')).toContainText('801.83兆円');
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
  await expect(projectionTable.getByRole('row').last()).toContainText('31.95%');
  await expect(page.getByTestId('input-overview').getByTestId('baseline-inflation-sensitivity')).toHaveCount(0);
  await expect(page.getByTestId('baseline-inflation-sensitivity')).not.toBeVisible();
  await page.getByTestId('baseline-sensitivity-details').locator('summary').click();
  await expect(page.getByTestId('baseline-inflation-sensitivity')).toBeVisible();
  await expect(page.getByTestId('tax-elasticity-sensitivity')).toHaveCount(0);
  await expect(page.getByTestId('theoretical-maximum')).toHaveText('29.6兆円');
  await expect(page.getByTestId('input-overview').getByTestId('recommended-envelope')).toHaveText('29.6兆円 / 年');
  await page.getByText('CPI上限別の感度と計算方法', { exact: true }).click();
  const sensitivity = page.getByTestId('cpi-limit-sensitivity');
  await expect(sensitivity.getByRole('row').filter({ hasText: '3.0%' })).toContainText('39.2兆円');
  await expect(sensitivity.getByRole('row').filter({ hasText: '3.5%' })).toContainText('39.2兆円');
  await openAdvanced(page);
  await page.getByRole('button', { name: '乗数・税収・労働反応の条件', exact: true }).click();
  const elasticity = page.getByLabel('名目GDPに対する税収弾性値（税）・数値で入力', { exact: true });
  await expect(elasticity).toHaveValue('1.3');
  await expect(page.getByText('現在は1.2', { exact: true })).toBeVisible();
  await expect(page.getByText('財務省答弁の実績ベースの値は1.7（2015〜2024年度）', { exact: true })).toBeVisible();
  await elasticity.fill('1.7');
  await expect(page.getByText('名目GDPが1%増えたとき、税（罰金を含む）が約1.7%、社会保険料が約1.0%増える想定です（減税分を引く前）。所得税・住民税・消費税の減税は税から、社会保険料減税は社会負担から差し引きます。入力した値を評価期間全体に適用します。', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(result.locator('[data-metric="税・社会保険料収入"]')).toContainText('266.55兆円');
  await expect(page.getByText('債務経路の仮定：名目GDPへの弾性値は税 1.7・社会保険料 1', { exact: false })).toBeVisible();
});

test('insurance relief stops at contributor revenue and readjusts when the split changes', async ({ page }) => {
  await page.goto('/fiscal-space');
  const input = page.getByLabel('社会保険料減税・数値で入力', { exact: true });
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await input.fill('100');
  await expect(input).toHaveValue('78.7');
  await expect(page.getByTestId('input-overview')).toContainText('78.70兆円 / 年');
  await expect(page.locator('[data-policy="social-insurance"]')).toHaveCount(0);
  await openAdvanced(page);
  await page.getByRole('button', { name: '乗数・税収・労働反応の条件', exact: true }).click();
  await page.getByLabel('社会保険料軽減の本人配分・数値で入力', { exact: true }).fill('100');
  await page.keyboard.press('Escape');
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
  await openAdvanced(page);
  await page.getByRole('button', { name: '産業・電力負荷の条件', exact: true }).click();
  // Consecutive edits must read immediate form state, not the debounced result.
  const planned = page.getByLabel('既定計画の非化石発電の年間追加量', { exact: true });
  const demand = page.getByLabel('共通の電力需要増加率', { exact: true });
  await planned.fill('10');
  await demand.fill('1');
  await expect(planned).toHaveValue('10');
  await expect(demand).toHaveValue('1');
  await page.keyboard.press('Escape');
  await expect(page.getByText('入力を反映しています。結果は直前の条件です。')).toHaveCount(0);
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  await expect(page.getByLabel('共有URL', { exact: true })).toHaveValue(/#scenario=/);
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  const before = await page.getByTestId('input-overview').innerText();
  await page.goto(url);
  await expect.poll(() => page.getByTestId('input-overview').innerText()).toEqual(before);
  await openAdvanced(page);
  await page.getByRole('button', { name: '産業・電力負荷の条件', exact: true }).click();
  await expect(planned).toHaveValue('10');
  await expect(demand).toHaveValue('1');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '基準データ・初期条件を設定', exact: true }).click();
  await page.getByRole('radio', { name: '2024年で揃える' }).check();
  await page.keyboard.press('Escape');
  await expect(amount).toHaveValue('10');
  await expect(page.getByTestId('recommended-envelope')).not.toHaveText('0.0兆円 / 年');
  await expect(page.getByTestId('input-overview').getByTestId('baseline-inflation-sensitivity')).toHaveCount(0);
  await expect(page.getByTestId('baseline-inflation-sensitivity')).not.toBeVisible();
  await page.getByTestId('baseline-sensitivity-details').locator('summary').click();
  await expect(page.getByTestId('baseline-inflation-sensitivity')).toBeVisible();
  await expect(page.locator('[data-observation-key="fiscal.grossDebt"]')).toContainText('214.50%');
  await openAdvanced(page);
  await page.getByRole('button', { name: '乗数・税収・労働反応の条件', exact: true }).click();
  await page.getByLabel('参照するマクロモデル').selectOption('esri2022');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '3年間の推計表' })).toBeVisible();
  await expect(page.getByRole('region', { name: '5年間の推計表' })).toHaveCount(0);
  await expect(page.getByTestId('horizon-results').getByRole('heading')).toHaveText('3年目の結果（試算）');
  expect(errors).toEqual([]);
});

test('mobile controls open over results and an invalid shared URL is explained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fiscal-space#scenario=invalid');
  await expect(page.getByRole('alert').filter({ hasText: '共有条件を復元できませんでした。' })).toContainText('共有条件を復元できません。初期状態（既定の条件）で計算しています。以下の数値は送信者の条件ではありません。');
  const panel = page.getByRole('region', { name: '政策の操作パネル' });
  await page.getByRole('button', { name: /^政策を調整/ }).click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('10');
  await expect(page.getByTestId('input-overview')).toContainText('10.00兆円');
  await page.getByRole('button', { name: /^政策パネルを閉じる/ }).first().click();
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
  await page.getByRole('button', { name: /^政策を調整/ }).click();
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('10');
  await expect(page.getByTestId('calculation-status')).toContainText('結果は直前の条件');
  await expect(page.getByTestId('calculation-status').getByRole('status')).toBeVisible();
  await expect(page.getByTestId('input-overview')).toContainText('10.00兆円');
  await expect(page.getByTestId('calculation-status')).toBeEmpty();
  await expect(page.getByRole('region', { name: '結果を左右する前提' })).toContainText('財政の評価は5年まで');
  await expect(page.locator('[data-constraint]').first()).toHaveAttribute('data-constraint', 'debt');
  await expect(page.getByTestId('fiscal-vintage').first()).toContainText('分子はIMF 2026年推計比率×分母2026Q2');
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
  // メーターは未評価でも斜線付きで常に描画されるため、評価済みかは data-status で判定する。
  const sectorMeter = page.locator('[data-constraint="sector"]');
  const energyMeter = page.locator('[data-constraint="energy"]');
  const evaluated = async (meter: typeof sectorMeter, expected: boolean) => {
    await expect(meter).toHaveCount(1);
    if (expected) await expect(meter).not.toHaveAttribute('data-status', 'unevaluated');
    else await expect(meter).toHaveAttribute('data-status', 'unevaluated');
  };
  // 既定の「公表統計を基に概算」モードでは、負荷係数を入力しなくても産業・電力の負荷が概算され、評価済みになる。
  await evaluated(sectorMeter, true);
  await evaluated(energyMeter, true);
  // 「手入力した負荷だけで評価」に切り替えると、係数未入力の負荷は未評価として扱われる。
  await openAdvanced(page);
  await page.getByRole('button', { name: '産業・電力負荷の条件', exact: true }).click();
  await page.getByRole('combobox', { name: '負荷の評価方法' }).selectOption('manual');
  const loads = page.getByRole('region', { name: '政策別の負荷条件', exact: true });
  await loads.locator('summary').click();
  await loads.getByLabel('公共投資の負荷条件を入力する').check();
  await page.keyboard.press('Escape');
  await evaluated(sectorMeter, false);
  await evaluated(energyMeter, false);
  await expect(page.getByTestId('recommended-envelope')).toContainText('算出不可：負荷が未評価');
  const notes = page.getByTestId('input-overview').locator('details').filter({ has: page.getByText('計算上の注意', { exact: true }) });
  await expect(notes).not.toHaveAttribute('open', '');
  await expect(notes.getByText('産業別・電力の追加負荷に未評価の項目があります。')).not.toBeVisible();
  await notes.locator('summary').click();
  await expect(notes.getByText('産業別・電力の追加負荷に未評価の項目があります。')).toBeVisible();
  await notes.locator('summary').click();
  await openAdvanced(page);
  await page.getByRole('button', { name: '産業・電力負荷の条件', exact: true }).click();
  await loads.getByLabel(/公共投資・支出1兆円の産業稼働率増分/).fill('0');
  await evaluated(sectorMeter, true);
  await evaluated(energyMeter, false);
  await loads.getByLabel('公共投資・負荷の入力方式').selectOption('project');
  await evaluated(sectorMeter, false);
  await loads.getByLabel(/公共投資・稼働後の年間電力量/).fill('8760');
  const conversion = page.getByTestId('load-conversion-public-investment');
  await expect(conversion).toContainText('稼働後ピーク 未評価');
  await loads.getByLabel(/公共投資・年間負荷率/).fill('0.5');
  await loads.getByLabel(/公共投資・系統ピークとの同時発生係数/).fill('0.75');
  await expect(conversion).toContainText('稼働後ピーク 0.750GW');
  await evaluated(energyMeter, false);
  await loads.getByLabel(/公共投資・支出年の追加ピーク電力/).fill('0');
  await evaluated(energyMeter, true);
  await loads.getByLabel(/公共投資・稼働後の系統ピークへの純追加電力/).fill('400');
  await expect(conversion).toContainText('稼働後ピーク 0.200GW');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '政策期間の比較', exact: true })).toContainText('同額予算での比較ではありません');
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await expect(page.getByTestId('input-overview')).toContainText('2.00兆円 / 年');
  await openAdvanced(page);
  await page.getByRole('button', { name: '産業・電力負荷の条件', exact: true }).click();
  await loads.locator('summary').click();
  await expect(conversion).toContainText('稼働後ピーク 0.200GW');
  await evaluated(energyMeter, true);
  await evaluated(sectorMeter, false);
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
  await openAdvanced(page);
  await page.getByRole('button', { name: '最大GDP・生産モデルの条件', exact: true }).click();
  await page.getByLabel('使用する生産モデル', { exact: true }).selectOption('cobbDouglas');
  await page.keyboard.press('Escape');
  await openAdvanced(page);
  await page.getByRole('button', { name: '政策別の供給力・長期条件', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^公共資本の蓄積/ }).click();
  await page.getByLabel('公共資本の蓄積・効果係数', { exact: true }).fill('1');
  await page.getByLabel('公共資本の蓄積・純追加性', { exact: true }).fill('100');
  await page.getByLabel('公共資本の蓄積・効果までの年数', { exact: true }).fill('0');
  await page.getByLabel('公共資本の蓄積・単位費用・基準資本比', { exact: true }).fill('0.01');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('calculation-status')).toBeEmpty();
  const chart = page.getByRole('img', { name: /5年推移/ });
  expect(await chart.locator('text').filter({ hasText: '兆円' }).count()).toBeLessThanOrEqual(9);
  await page.getByLabel('公共投資・数値で入力', { exact: true }).fill('99');
  await expect(page.getByTestId('input-overview')).toContainText('99.00兆円 / 年');
});


test('all policies are expanded and personal tax inputs stop at eligible revenue', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('input-overview')).toBeVisible();
  await expect(page.getByText('ほかの8政策を追加する', { exact: true })).toHaveCount(0);
  for (const [name, cap] of [['所得税減税', '21.2'], ['住民税減税', '12.6']]) {
    const input = page.getByLabel(`${name}・数値で入力`, { exact: true });
    await input.fill('100');
    await expect(input).toHaveValue(cap);
    await expect(input).toHaveAttribute('max', cap);
    await input.fill('0');
  }
});

test('generation settings open beside the amount and stay linked to results and shared URLs', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('input-overview')).toBeVisible();
  const amount = page.getByLabel('発電設備投資・数値で入力', { exact: true });
  await amount.fill('1');
  const trigger = page.getByRole('button', { name: '電源構成・稼働時期を設定', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '発電設備投資の設定', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('power-investment-total')).toHaveText('1.0兆円／年');
  await expect(dialog.getByLabel('太陽光・稼働まで', { exact: true })).toHaveValue('1');
  await dialog.getByLabel('太陽光・稼働まで', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: '設定を閉じて結果を見る', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const timeline = page.getByTestId('power-timeline');
  await timeline.locator('summary').click();
  await expect(timeline.locator('[data-power-year="1"] [data-power-supply]')).not.toHaveText('0.00');
  await amount.fill('2');
  await trigger.click();
  await expect(dialog.getByTestId('power-investment-total')).toHaveText('2.0兆円／年');
  await dialog.getByLabel('太陽光・稼働まで', { exact: true }).fill('1');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(timeline.locator('[data-power-year="1"] [data-power-supply]')).toHaveText('0.00');
  await expect(timeline.locator('[data-power-year="2"] [data-power-supply]')).not.toHaveText('0.00');
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await expect(amount).toHaveValue('2');
  await trigger.click();
  await expect(dialog.getByLabel('太陽光・稼働まで', { exact: true })).toHaveValue('1');
});


test('remaining assumptions are edited in panels and restored from the shared URL', async ({ page }) => {
  await page.goto('/fiscal-space');
  await expect(page.getByTestId('horizon-results')).toBeVisible();
  const results = page.locator('main').getByRole('heading', { name: '詳細条件・出典', exact: true });
  await expect(results).toBeVisible();
  await expect(page.locator('main').getByLabel('法人税の賃金帰着割合')).toHaveCount(0);
  await expect(page.locator('main').getByLabel('試算する政策', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '家計負担の推計条件を設定', exact: true }).click();
  await page.getByRole('dialog', { name: '家計負担の推計条件', exact: true }).getByLabel('法人税の賃金帰着割合').selectOption('0.5');
  await page.keyboard.press('Escape');
  await openAdvanced(page);
  await page.getByRole('button', { name: '政策別の事業条件', exact: true }).click();
  const trade = page.getByRole('dialog', { name: '政策別の事業条件', exact: true });
  await expect(trade.getByTestId('project-import-estimate')).toContainText('17.6%');
  await expect(trade.getByRole('region', { name: '政策固有の輸出入試算' })).not.toContainText('未推計');
  await trade.getByLabel('試算する政策', { exact: true }).selectOption('rd');
  await expect(trade.getByLabel('投資1円あたり稼働後の年間売上（円/年）', { exact: true })).toHaveValue('0.6');
  await expect(trade.getByTestId('research-project-estimate')).toContainText('逆算値');
  await expect(trade.getByRole('region', { name: '政策固有の輸出入試算' })).not.toContainText('未推計');
  await trade.getByLabel('試算する政策', { exact: true }).selectOption('semiconductors');
  await trade.getByLabel('売上の輸出割合（仮定）（%）', { exact: true }).fill('60');
  await trade.getByLabel('試算する政策', { exact: true }).selectOption('generation');
  await trade.getByRole('button', { name: '電源構成・稼働時期を設定', exact: true }).click();
  const power = page.getByRole('dialog', { name: '発電設備投資の設定', exact: true });
  await expect(trade).not.toBeVisible();
  await power.getByText('電源別の輸入・火力置換の条件', { exact: true }).click();
  await power.getByLabel('太陽光・追加の出力制御率（仮定）', { exact: true }).fill('12');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'この条件のURLをコピー' }).click();
  const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
  await page.goto(url);
  await page.getByRole('button', { name: '家計負担の推計条件を設定', exact: true }).click();
  await expect(page.getByLabel('法人税の賃金帰着割合')).toHaveValue('0.5');
  await page.keyboard.press('Escape');
  await openAdvanced(page);
  await page.getByRole('button', { name: '政策別の事業条件', exact: true }).click();
  await trade.getByLabel('試算する政策', { exact: true }).selectOption('semiconductors');
  await expect(trade.getByLabel('売上の輸出割合（仮定）（%）', { exact: true })).toHaveValue('60');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '電源構成・稼働時期を設定', exact: true }).click();
  await power.getByText('電源別の輸入・火力置換の条件', { exact: true }).click();
  await expect(power.getByLabel('太陽光・追加の出力制御率（仮定）', { exact: true })).toHaveValue('12');
});
