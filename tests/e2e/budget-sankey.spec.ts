import { expect, test, type Page } from '@playwright/test';
import { UNIFIED_BASES_BY_YEAR, unifiedGraphFileName } from '../../types/unified-budget';

/**
 * 統合ビュー（/budget-sankey）の E2E。
 *
 * /sankey-svg を統合ビューで置き換えるための安全網として、sankey-svg.spec.ts が押さえている
 * 操作（検索 → 選択、サイドパネル、表示件数、深いリンク、年度切替、ズーム）を統合ビューの
 * セレクタで検証する。2024 年度のグラフは 20MB 近いので、描画待ちは長めに取る。
 */

const CANVAS = '[data-testid="unified-canvas"]';
const RENDER_TIMEOUT = 60_000;

test('GIGA budget label retains the initial budget when spending is larger', async ({ page }) => {
  await openPage(page, 'year=2024&b=initial&sel=project-budget-1503');
  await expect(page.getByTestId('unified-label').filter({ hasText: 'GIGA' }).filter({ hasText: '5.08億円' })).toBeVisible();
});

/** ページを開いて図が出るまで待つ。ページエラーは呼び出し側で検証できるよう配列に集める */
async function openPage(page: Page, query = 'year=2024'): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`/budget-sankey?${query}`);
  await page.waitForSelector(CANVAS, { timeout: RENDER_TIMEOUT });
  await expect(page.getByTestId('unified-node').first()).toBeAttached({ timeout: RENDER_TIMEOUT });
  return pageErrors;
}

/** 列見出し（`事業_2024` のような `<text>`）。tspan の測定量は含めずに前方一致で探す */
function columnHeader(page: Page, label: string) {
  return page.locator(`${CANVAS} text`).filter({ hasText: new RegExp(`^${label}`) });
}

/** 列見出しの並び（x 座標順）を返す */
async function headerOrder(page: Page): Promise<string[]> {
  return page.locator(`${CANVAS} text`).evaluateAll(nodes =>
    nodes
      .filter(n => /^(会計|所管|組織\/勘定|項|目|事業|事業\(支出\)|支出先)_\d{4}/.test(n.textContent ?? ''))
      .map(n => ({ x: Number(n.getAttribute('x')), text: (n.textContent ?? '').split(' ')[0] }))
      .sort((a, b) => a.x - b.x)
      .map(n => n.text)
  );
}

/** 検索結果ボタン（列名の小さいラベル + ノード名 + 金額） */
function searchResults(page: Page) {
  return page.locator('button').filter({ has: page.locator('span.truncate') });
}

/** 図のノード（data-column 付き）の数 */
function nodeCount(page: Page, column?: string): Promise<number> {
  return page.locator(column ? `[data-testid="unified-node"][data-column="${column}"]` : '[data-testid="unified-node"]').count();
}

/** ラベル（`<text data-testid="unified-label">`）のテキスト一覧。切り詰め前の名前とは一致しないことがある */
function labelTexts(page: Page): Promise<string[]> {
  return page.getByTestId('unified-label').evaluateAll(nodes => nodes.map(n => n.textContent ?? ''));
}

/** 現在の URL のクエリ */
function urlParams(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

test.describe('budget-sankey (統合ビュー)', () => {
  test('every enabled budget dataset is deployed as browser-readable JSON', async ({ request }) => {
    const files = new Set(Object.entries(UNIFIED_BASES_BY_YEAR).flatMap(([year, bases]) =>
      bases.map(basis => unifiedGraphFileName(Number(year), basis))));
    for (const file of files) {
      const response = await request.get(`/data/${file}`);
      expect(response.status(), file).toBe(200);
      expect(response.headers()['content-type'], file).toContain('application/json');
      const graph = await response.json();
      expect(graph.nodes.length, file).toBeGreaterThan(0);
    }
  });

  test('2026 supplementary budget opens through the selector and a direct link', async ({ page }) => {
    const errors = await openPage(page, 'year=2026');
    await page.getByLabel('基準', { exact: true }).selectOption('supplementary');
    await expect(columnHeader(page, '会計_2026').first()).toHaveText('会計_2026 補正後（改予算額）');
    await expect(page.getByTestId('unified-label').filter({ hasText: /^一般会計/ })).toContainText('125.42兆円');
    expect(urlParams(page).get('b')).toBe('supplementary');
    await page.reload();
    await expect(columnHeader(page, '会計_2026').first()).toHaveText('会計_2026 補正後（改予算額）');
    await expect(page.getByTestId('unified-label').filter({ hasText: /^一般会計/ })).toContainText('125.42兆円');
    expect(errors).toEqual([]);
  });

  test('renders nodes and column headers without page errors', async ({ page }) => {
    const pageErrors = await openPage(page);

    expect(await nodeCount(page)).toBeGreaterThan(0);
    // 既定プリセット「統合」の列（組織/勘定・目は畳まれている）
    expect(await headerOrder(page)).toEqual(['会計_2024', '所管_2024', '項_2024', '事業_2024', '事業(支出)_2024', '支出先_2024']);
    // 事業列は「何年度の・何の額か」を添える
    await expect(columnHeader(page, '事業_2024').first()).toHaveText(/^事業_2024 (歳出予算現額|当初予算)$/);
    await expect(columnHeader(page, '支出先_2024').first()).toHaveText('支出先_2024 支出額');
    expect(pageErrors).toEqual([]);
  });

  test('search lists matches and choosing one selects the node and opens the side panel', async ({ page }) => {
    await openPage(page);
    const sidePanel = page.getByTestId('unified-side-panel');

    await page.getByLabel('ノードを検索').fill('基礎年金');
    const results = searchResults(page);
    await expect(results.first()).toBeVisible({ timeout: 10_000 });
    expect(await results.count()).toBeGreaterThan(1);
    for (const text of await results.allInnerTexts()) expect(text).toContain('基礎年金');

    // 結果は「列名チップ + ノード名」。チップ（先頭の span）を除いた部分がノード名
    const chosenName = await results.first().locator('span.truncate').evaluate(el => {
      const chip = el.firstElementChild?.textContent ?? '';
      return (el.textContent ?? '').slice(chip.length);
    });
    await results.first().click();

    await expect(page).toHaveURL(/[?&]sel=/);
    await expect(sidePanel).toBeVisible();
    await expect(sidePanel.locator('.font-semibold').first()).toContainText(chosenName.slice(0, 6));
    // 検索欄は選択後に空に戻る
    await expect(page.getByLabel('ノードを検索')).toHaveValue('');
  });

  test('RS project side panel shows sections in order and 選択を解除 closes it', async ({ page }) => {
    await openPage(page, 'year=2024&sel=project-budget-2826');
    const sidePanel = page.getByTestId('unified-side-panel');

    await expect(sidePanel).toBeVisible();
    await expect(sidePanel.getByText('基礎年金給付に必要な経費').first()).toBeVisible({ timeout: 10_000 });
    await expect(sidePanel.getByText('政策評価', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // セクション見出しの並び。みんなの意見は Supabase 未配布の環境では出ないので任意
    const headings = await sidePanel
      .locator('span, div')
      .evaluateAll(nodes =>
        nodes
          .map(n => (n.childElementCount === 0 ? (n.textContent ?? '').trim() : ''))
          .filter(t => ['みんなの意見', '政策評価', '事業概要', '予算・執行'].includes(t))
      );
    const expected = ['みんなの意見', '政策評価', '事業概要', '予算・執行'];
    const withoutComments = expected.filter(h => h !== 'みんなの意見');
    expect([expected, withoutComments]).toContainEqual([...new Set(headings)]);

    // 政策評価は 6 軸（総合点 + 5 軸）で出る
    for (const axis of ['総合点', '成果設計', '検証可能性', '執行透明性', '費用対内容', '必要性']) {
      await expect(sidePanel.getByText(axis, { exact: true }).first()).toBeVisible();
    }
    await expect(sidePanel.getByText('図には出ていません')).toHaveCount(0);

    await sidePanel.getByLabel('選択を解除').click();
    await expect(page).not.toHaveURL(/[?&]sel=/);
    await expect(sidePanel.getByText('基礎年金給付に必要な経費')).toHaveCount(0);
  });

  test('項 side panel shows the weighted-average policy evaluation block', async ({ page }) => {
    await openPage(page);

    await page.getByLabel('ノードを検索').fill('基礎年金');
    const sectionResult = searchResults(page).filter({ has: page.locator('span.text-\\[10px\\]', { hasText: /^項$/ }) }).first();
    await expect(sectionResult).toBeVisible({ timeout: 10_000 });
    await sectionResult.click();

    await expect(page).toHaveURL(/[?&]sel=sec-/);
    const sidePanel = page.getByTestId('unified-side-panel');
    await expect(sidePanel.getByText('項', { exact: true }).first()).toBeVisible();
    await expect(sidePanel.getByText('配下の RS事業の金額加重平均')).toBeVisible({ timeout: 30_000 });
    await expect(sidePanel.getByText('総合点', { exact: true }).first()).toBeVisible();
  });

  test('TopN stepper increments the count and URL param; holding repeats', async ({ page }) => {
    await openPage(page);
    const countButton = page.getByLabel('項の表示件数');
    const increase = page.getByLabel('項の件数を増やす');

    await expect(countButton).toHaveText('40');
    await increase.click();
    await expect(countButton).toHaveText('41');
    await expect.poll(() => urlParams(page).get('tse')).toBe('41');

    // 押し続けると連続で増える（約 1 秒後から加速）
    const box = await increase.boundingBox();
    if (!box) throw new Error('増やすボタンが見つかりません');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1_500);
    await page.mouse.up();
    const held = Number(await countButton.innerText());
    expect(held).toBeGreaterThan(42);
    await expect.poll(() => urlParams(page).get('tse')).toBe(String(held));
  });

  test('deep link to a low-ranked 項 reveals it in the graph via offset', async ({ page, request }) => {
    const res = await request.get('/api/quality-sections?year=2026');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { items: Array<{ id: string; sectionName: string }> };
    const target = body.items[300];
    expect(target.id).toMatch(/^sec-/);

    await openPage(page, `year=2026&sel=${encodeURIComponent(target.id)}`);
    const sidePanel = page.getByTestId('unified-side-panel');

    await expect(sidePanel.getByText(target.sectionName).first()).toBeVisible({ timeout: 10_000 });
    // 表示位置が自動で動いて図に出る
    await expect.poll(() => urlParams(page).get('ose'), { timeout: 15_000 }).not.toBeNull();
    await expect(sidePanel.getByText('図には出ていません')).toHaveCount(0);
    const labelPrefix = target.sectionName.slice(0, 6);
    await expect.poll(async () => (await labelTexts(page)).some(t => t.startsWith(labelPrefix))).toBe(true);
  });

  test('year switch updates the column header year and falls back to 当初予算', async ({ page }) => {
    await openPage(page, 'year=2024&b=settlement');
    const basisSelect = page.getByLabel('基準');
    await expect(basisSelect).toHaveValue('settlement');

    await page.getByLabel('年度').selectOption('2026');
    await expect(page.getByLabel('年度')).toHaveValue('2026');
    await expect(columnHeader(page, '事業_2026').first()).toBeAttached({ timeout: RENDER_TIMEOUT });
    await expect(columnHeader(page, '事業_2024')).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]year=2026/);

    // 2026 には決算が無いので当初予算へ戻り、決算の選択肢は disabled（補正は第1号が出ているので選べる）
    await expect(basisSelect).toHaveValue('initial');
    await expect(basisSelect.locator('option[value="settlement"]')).toBeDisabled();
    await expect(basisSelect.locator('option[value="supplementary"]')).toBeEnabled();
    await expect(page).not.toHaveURL(/[?&]b=/);
  });

  test('basis switch to 決算 changes the header measure text', async ({ page }) => {
    await openPage(page);
    await expect(columnHeader(page, '項_2024').first()).toContainText('当初予算');

    await page.getByLabel('基準').selectOption('settlement');
    await expect(page).toHaveURL(/[?&]b=settlement/);
    await expect(columnHeader(page, '項_2024').first()).toContainText('支出済額', { timeout: RENDER_TIMEOUT });
    await expect(columnHeader(page, '事業_2024').first()).toContainText('執行額');
  });

  test('preset RSのみ hides 会計 and starts with 所管; URL cols updates', async ({ page }) => {
    await openPage(page);
    expect((await headerOrder(page))[0]).toBe('会計_2024');

    await page.getByLabel('表示プリセット').selectOption('rs');
    await expect(page.getByLabel('表示プリセット')).toHaveValue('rs');
    await expect(columnHeader(page, '会計_2024')).toHaveCount(0);
    await expect.poll(() => urlParams(page).get('cols')).toBe('mi,pr,ps,re');
    expect(await headerOrder(page)).toEqual(['所管_2024', '事業_2024', '事業(支出)_2024', '支出先_2024']);
    // RSのみ では非事業ノードを出さない
    await expect(page).toHaveURL(/[?&]fnrs=0/);
  });

  test('filter panel: unchecking 一般会計 leaves only 特別会計; clicking outside closes it', async ({ page }) => {
    await openPage(page);
    const before = await nodeCount(page);
    const accountNodesBefore = await nodeCount(page, 'account');

    await page.getByLabel('絞り込みを開く').click();
    await expect(page.getByLabel('絞り込みを閉じる')).toBeVisible();
    await expect(page).toHaveURL(/[?&]ffp=1/);

    // 会計区分は「チェックした区分だけ」に絞る。特別会計だけをオンにする
    await page.getByLabel('特別会計', { exact: true }).check();
    await expect(page).toHaveURL(/[?&]fac=special/);
    await expect.poll(() => nodeCount(page)).not.toBe(before);
    const accountLabels = await page
      .locator('[data-testid="unified-node"][data-column="account"] [data-testid="unified-label"]')
      .evaluateAll(nodes => nodes.map(n => n.textContent ?? ''));
    expect(accountLabels.length).toBeGreaterThan(0);
    expect(accountLabels.length).toBeLessThan(accountNodesBefore);
    expect(accountLabels.some(t => t.startsWith('一般会計'))).toBe(false);

    // 図の外側（ノードでない場所）を押すとパネルが閉じる
    const canvas = page.locator(CANVAS);
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas が見つかりません');
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + 8);
    await expect(page.getByLabel('絞り込みを開く')).toBeVisible();
    await expect(page.getByLabel('名前で絞り込み')).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]ffp=1/);
  });

  test('表示設定 popover closes on outside click', async ({ page }) => {
    await openPage(page);
    const dialog = page.getByRole('dialog', { name: '表示設定' });

    await page.getByLabel('表示設定を開く').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('文字サイズ')).toBeVisible();

    const canvasBox = await page.locator(CANVAS).boundingBox();
    if (!canvasBox) throw new Error('canvas が見つかりません');
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + 8);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('表示設定を開く')).toHaveAttribute('aria-expanded', 'false');
  });

  test('deep link restores year, preset, TopN/offset and selection', async ({ page }) => {
    // 選択した事業（事業列の 1 位）が窓に入るよう、事業列の表示位置は 0 のままにし、支出先列で表示位置を確認する。
    // 支出先の列があるのは 2024 年度（執行年度）のみ
    const pageErrors = await openPage(page, 'year=2024&cols=mi,pr,ps,re&tpr=25&tre=30&ore=5&sel=project-budget-2826');

    await expect(page.getByLabel('年度')).toHaveValue('2024');
    await expect(page.getByLabel('表示プリセット')).toHaveValue('rs');
    await expect(page.getByLabel('事業の表示件数')).toHaveText('25');
    await expect(page.getByLabel('支出先の表示件数')).toHaveText('30');
    await expect(page.getByLabel('支出先の表示開始位置')).toHaveAttribute('aria-valuenow', '5');
    expect(await headerOrder(page)).toEqual(['所管_2024', '事業_2024', '事業(支出)_2024', '支出先_2024']);

    const sidePanel = page.getByTestId('unified-side-panel');
    await expect(sidePanel.getByText('基礎年金給付に必要な経費').first()).toBeVisible({ timeout: 10_000 });
    await expect(sidePanel.getByText('事業', { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(/sel=project-budget-2826/);
    await expect(page).toHaveURL(/tpr=25/);
    await expect(page).toHaveURL(/ore=5/);
    expect(pageErrors).toEqual([]);
  });

  test('link tooltip appears when hovering a ribbon', async ({ page }) => {
    await openPage(page);
    const links = page.getByTestId('unified-link');
    await expect(links.first()).toBeAttached();

    // 全ラベル表示ではリボンの外接矩形の中心が画面外になるため、画面内の実際の塗りを探す。
    const point = await page.evaluate(() => {
      for (let y = 150; y < innerHeight - 60; y += 12) {
        for (let x = 30; x < innerWidth - 30; x += 12) {
          if (document.elementFromPoint(x, y)?.getAttribute('data-testid') === 'unified-link') return { x, y };
        }
      }
      return null;
    });
    expect(point).not.toBeNull();
    await page.mouse.move(point!.x, point!.y);
    await expect(page.getByTestId('unified-link-tooltip')).toContainText('→');
  });
});
