import { test, expect, type Page } from '@playwright/test';

/** 世帯年収は値の表示をクリックするとその場で入力欄になる */
async function setIncome(page: Page, manYen: string) {
  await page.getByRole('button', { name: '世帯年収を万円で入力', exact: true }).click();
  const input = page.getByRole('spinbutton', { name: '世帯年収を万円で入力', exact: true });
  await input.fill(manYen);
  await input.press('Enter');
}

test('individual tax resets preserve other reforms and household conditions, including after reload', async ({ page }) => {
  await page.goto('/tax-burden');
  await setIncome(page, '800');
  await page.getByRole('button', { name: /^税・給付/ }).click();
  const input = (name: string) => page.getByLabel(`${name}・数値で入力`, { exact: true });
  await input('給付付き控除（年額）').fill('30');
  await input('逓減の開始年収').fill('500');
  await input('逓減率').fill('20');
  for (const [name, changed] of [
    ['住民税（所得割）', '5'], ['年金保険料率', '4'], ['医療保険料率', '3'],
    ['介護保険料率', '1'], ['雇用保険料率', '1'], ['所得税の基礎控除', '150'], ['児童手当（月額）', '30000'],
  ]) {
    const before = await input(name).inputValue();
    const reset = page.getByRole('button', { name: `${name}をリセット`, exact: true });
    await expect(reset).toBeDisabled();
    await input(name).fill(changed);
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(input(name)).toHaveValue(before);
    await expect(reset).toBeDisabled();
    await expect(input('給付付き控除（年額）')).toHaveValue('30');
  }
  await input('消費税・標準税率').fill('5');
  await input('消費税・軽減税率').fill('3');
  await page.getByRole('button', { name: '消費税をリセット', exact: true }).click();
  await expect(input('消費税・標準税率')).toHaveValue('10');
  await expect(input('消費税・軽減税率')).toHaveValue('8');
  await expect(input('給付付き控除（年額）')).toHaveValue('30');
  await input('住民税（所得割）').fill('7');
  await page.getByRole('button', { name: '給付付き控除をリセット', exact: true }).click();
  await expect(input('給付付き控除（年額）')).toHaveValue('0');
  await expect(input('逓減の開始年収')).toHaveValue('300');
  await expect(input('逓減率')).toHaveValue('10');
  await expect.poll(() => new URL(page.url()).searchParams.get('creditAnnual')).toBe('0');
  await page.reload();
  await expect(page.getByRole('button', { name: '世帯年収を万円で入力', exact: true })).toHaveText('800万円');
  await page.getByRole('button', { name: /^税・給付/ }).click();
  await expect(input('住民税（所得割）')).toHaveValue('7');
  await expect(input('給付付き控除（年額）')).toHaveValue('0');
  await expect(input('消費税・軽減税率')).toHaveValue('8');
});

test('corporate incidence leaves cash disposable income unchanged at fixed salary', async ({ page }) => {
  await page.goto('/tax-burden');
  await setIncome(page, '500');
  const share = page.getByRole('slider', { name: '賃金へ転嫁される割合', exact: true });
  await share.press('Home');
  await expect(share).toHaveValue('0');
  const cash = page.getByText(/^可処分所得（現金）：/);
  await expect(cash).toBeVisible();
  const cashBefore = await cash.innerText();
  for (let i = 0; i < 25; i++) await share.press('ArrowRight');
  await expect(share).toHaveValue('25');
  await expect(page.getByRole('rowheader', { name: '法人税の転嫁（仮定）', exact: true })).toBeVisible();
  await expect(cash).toHaveText(cashBefore);
});

test('tax prototype: reform, shared conditions, actual revenue, unavailable statistics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tax-burden');
  await expect(page.getByRole('heading', { name: '誰が、どれだけ負担している？' })).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await page.getByRole('button', { name: /^税・給付/ }).click();
  await page.getByLabel('給付付き控除（年額）・数値で入力', { exact: true }).fill('30');
  await expect(page.getByText('100,000円', { exact: true }).first()).toBeVisible();
  const url = page.url();
  await page.reload();
  await page.getByRole('button', { name: /^税・給付/ }).click();
  await expect(page.getByLabel('給付付き控除（年額）・数値で入力', { exact: true })).toHaveValue('30');
  expect(page.url()).toBe(url);
  await page.getByRole('button', { name: 'データについて', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '国の税収', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: '法人税', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '実態統計', exact: true }).click();
  await expect(page.getByRole('heading', { name: '年収十分位別の負担率（実測＋消費税推計）' })).toBeVisible();
  await page.getByRole('button', { name: '年齢で見る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '同じ所得階層の人が、年齢とともにどれだけ負担するか' })).toBeVisible();
  await page.getByRole('button', { name: '税目×年齢×年収', exact: true }).click();
  // This scenario includes child benefit, the reform credit and their aggregate,
  // as well as the default corporate incidence and pension receipt panels.
  await expect(page.getByRole('table', { name: /ヒートマップ/ })).toHaveCount(13);
  await expect(page.getByRole('table', { name: /^改革案の追加給付/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '税目ごとに分解する' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile: no horizontal overflow and zero income is not a numeric rate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tax-burden');
  await expect(page.getByRole('table').first()).toBeVisible();
  await setIncome(page, '0');
  await expect(page.getByText('未定義', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
