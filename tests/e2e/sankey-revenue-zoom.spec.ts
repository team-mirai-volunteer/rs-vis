import { expect, test } from '@playwright/test';

test('thickness changes amounts independently of font size and survives sharing and reset', async ({ page }) => {
  await page.goto('/budget-sankey?year=2024');
  const nodes = page.getByTestId('unified-node').locator('rect');
  await expect(nodes.first()).toBeVisible();
  await expect(page.locator('[data-testid="unified-node"][data-column="revenue"]').first()).toBeVisible();
  const geometry = () => nodes.evaluateAll(rs => rs.map(r => ({ height: Number(r.getAttribute('height')), width: r.getAttribute('width') })));
  const before = await geometry();
  await page.getByRole('button', { name: '表示設定を開く', exact: true }).click();
  const slider = page.getByRole('slider', { name: '帯・ノードの太さ', exact: true });
  await expect(slider).toHaveValue('1');
  await expect(slider).toHaveCSS('appearance', 'none');
  await expect(page.getByRole('slider', { name: '基準フォントサイズ', exact: true })).toHaveCSS('appearance', 'none');
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('1.1');
  await page.getByRole('button', { name: '帯・ノードの太さを大きく', exact: true }).click();
  await expect(slider).toHaveValue('1.2');
  await page.getByRole('button', { name: '帯・ノードの太さ編集を開始', exact: true }).click();
  await page.getByRole('spinbutton', { name: '帯・ノードの太さ(数値)', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: '帯・ノードの太さ(数値)', exact: true }).press('Enter');
  await expect(slider).toHaveValue('2');
  await expect(page).toHaveURL(/th=1(?:&|$)/);
  const after = await geometry();
  before.forEach((r, i) => {
    if (r.height > 1) expect(after[i].height).toBeCloseTo(r.height * 2, 6);
    expect(after[i].width).toBe(r.width);
  });
  await expect(page.getByTestId('unified-label').first()).toHaveAttribute('font-size', '13');
  await page.reload();
  await expect(nodes.first()).toBeVisible();
  expect(await geometry()).toEqual(after);
  await page.getByRole('button', { name: '表示設定を開く', exact: true }).click();
  await expect(slider).toHaveValue('2');
  await page.getByRole('button', { name: '帯・ノードの太さを既定値に戻す', exact: true }).click();
  await expect(slider).toHaveValue('1');
  expect(await geometry()).toEqual(before);
});

test('mobile pinch scales both axes around the two-finger midpoint', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('/budget-sankey?year=2024');
    const canvas = page.getByTestId('unified-canvas');
    await expect(canvas).toBeVisible();
    const before = (await canvas.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 100, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 100, y: 400 }, { id: 2, x: 220, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: 70, y: 400 }, { id: 2, x: 250, y: 400 }] });
    await expect(page.getByRole('button', { name: '150%', exact: true })).toBeVisible();
    const after = (await canvas.boundingBox())!;
    expect(after.width / before.width).toBeCloseTo(1.5, 3);
    expect(after.height / before.height).toBeCloseTo(1.5, 3);
    expect((160 - before.x) / before.width).toBeCloseTo((160 - after.x) / after.width, 3);
    expect((400 - before.y) / before.height).toBeCloseTo((400 - after.y) / after.height, 3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('tax receipts open with provenance and retain their account when columns change', async ({ page }) => {
  const query = new URLSearchParams({ year: '2024', b: 'initial', sel: 'revenue-acct-general|tax|消費税' });
  await page.goto(`/budget-sankey?${query}`);
  const panel = page.getByTestId('unified-side-panel');
  await expect(panel).toContainText('消費税');
  await expect(panel).toContainText('歳入予算額（全額）');
  await expect(panel).toContainText('個別事業に充てられた額を示しません');
  await expect(panel.getByRole('link', { name: '予算書の出典' })).toHaveAttribute('href', 'https://www.bb.mof.go.jp/server/2024/csv/DL202411001.zip');
  await page.getByRole('button', { name: '表示設定を開く', exact: true }).click();
  await expect(page.getByRole('button', { name: '会計', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: '基準', exact: true }).selectOption('supplementary');
  await expect(page.locator('[data-testid="unified-node"][data-column="revenue"]').first()).toBeVisible();
  await expect(panel).toContainText('歳入予算額（補正後）（全額）');
  await expect(panel.getByRole('link', { name: '予算書の出典', exact: true })).toHaveAttribute('href', 'https://www.bb.mof.go.jp/server/2024/csv/DL202421001.zip');
  await page.getByRole('combobox', { name: '基準', exact: true }).selectOption('settlement');
  await expect(page.locator('[data-testid="unified-node"][data-column="revenue"]').first()).toBeVisible();
  await expect(panel).toContainText('収納済歳入額（全額）');
  await expect(panel.getByRole('link', { name: '予算書の出典', exact: true })).toHaveAttribute('href', 'https://www.bb.mof.go.jp/server/2024/csv/DL202477001.zip');
  await page.reload();
  await expect(panel).toContainText('収納済歳入額（全額）');
});

test('zoom scales both axes around the pointer; larger labels get space without changing flow thickness', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/budget-sankey?year=2024');
  const canvas = page.getByTestId('unified-canvas');
  await expect(canvas).toBeVisible();
  const nodes = page.getByTestId('unified-node').locator('rect');
  const geometry = () => nodes.evaluateAll(rects => rects.map(r => ({ x: r.getAttribute('x'), y: r.getAttribute('y'), height: r.getAttribute('height') })));
  const original = await geometry();
  const paths = await page.getByTestId('unified-link').evaluateAll(paths => paths.map(p => p.getAttribute('d')));
  const before = (await canvas.boundingBox())!;
  const anchor = { x: 650, y: 500 };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -120);
  await expect(page.getByRole('button', { name: '120%', exact: true })).toBeVisible();
  const after = (await canvas.boundingBox())!;
  expect(after.width / before.width).toBeCloseTo(1.2, 4);
  expect(after.height / before.height).toBeCloseTo(1.2, 4);
  expect((anchor.x - before.x) / before.width).toBeCloseTo((anchor.x - after.x) / after.width, 4);
  expect((anchor.y - before.y) / before.height).toBeCloseTo((anchor.y - after.y) / after.height, 4);
  expect(await geometry()).toEqual(original);
  expect(await page.getByTestId('unified-link').evaluateAll(paths => paths.map(p => p.getAttribute('d')))).toEqual(paths);

  await page.getByRole('button', { name: '120%', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'ズーム率(数値)' }).fill('200');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '200%', exact: true })).toBeVisible();
  expect((await canvas.boundingBox())!.width / before.width).toBeCloseTo(2, 4);
  await page.getByRole('button', { name: '全体を表示', exact: true }).click();

  const label = page.getByTestId('unified-label').first();
  const labelBefore = (await label.boundingBox())!;
  await page.getByRole('button', { name: '表示設定を開く', exact: true }).click();
  await page.getByRole('button', { name: '基準フォントサイズ編集を開始' }).click();
  await page.getByRole('spinbutton', { name: '基準フォントサイズ(数値)' }).fill('20');
  await page.keyboard.press('Enter');
  await expect(label).toHaveAttribute('font-size', '20');
  const enlarged = await geometry();
  expect(enlarged.map(r => r.height)).toEqual(original.map(r => r.height));
  expect(enlarged.some((r, i) => r.y !== original[i].y)).toBe(true);
  expect((await label.boundingBox())!.height).toBeGreaterThan(labelBefore.height);
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(before.width);
});
