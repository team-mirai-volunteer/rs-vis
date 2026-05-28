import { expect, test } from '@playwright/test';

async function visibleNodeCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('[data-testid="sankey-node"]').evaluateAll(nodes => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < viewportWidth &&
        rect.top < viewportHeight
      );
    }).length;
  });
}

async function selectSearchResultByTitle(page: import('@playwright/test').Page, title: string): Promise<void> {
  const result = page.getByTestId('search-result').filter({
    has: page.locator(`[title="${title}"]`),
  }).first();
  await expect(result).toBeVisible({ timeout: 30_000 });
  await result.click();
}

async function visibleSvgTextMatching(page: import('@playwright/test').Page, text: string): Promise<number> {
  return page.locator('svg text').evaluateAll((nodes, expected) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return nodes.filter(node => {
      if (!node.textContent?.includes(expected)) return false;
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < viewportWidth &&
        rect.top < viewportHeight
      );
    }).length;
  }, text);
}

async function aggregateBoundaryGaps(page: import('@playwright/test').Page): Promise<number[]> {
  return page.locator('g.snk-node').evaluateAll(nodes => {
    const rows = nodes.map(node => {
      const texts = Array.from(node.querySelectorAll('text'));
      const text = texts.at(-1);
      const shape = node.querySelector('rect,path');
      if (!text || !shape) return null;
      const textBox = text.getBoundingClientRect();
      const shapeBox = shape.getBoundingClientRect();
      return {
        text: text.textContent ?? '',
        x: Math.round(shapeBox.left),
        textBottom: textBox.bottom,
        rectTop: shapeBox.top,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    const rowsByColumn = new Map<number, typeof rows>();
    for (const row of rows) {
      if (!rowsByColumn.has(row.x)) rowsByColumn.set(row.x, []);
      rowsByColumn.get(row.x)!.push(row);
    }

    const gaps: number[] = [];
    const aggregateLabelPattern = /^(?:[\d,]+(?:事業|支出先|省庁)|その他 \()/;
    for (const columnRows of rowsByColumn.values()) {
      columnRows.sort((a, b) => a.rectTop - b.rectTop);
      for (let i = 1; i < columnRows.length; i++) {
        if (aggregateLabelPattern.test(columnRows[i].text)) {
          gaps.push(columnRows[i].rectTop - columnRows[i - 1].textBottom);
        }
      }
    }
    return gaps;
  });
}

async function visibleSvgTextFill(page: import('@playwright/test').Page, text: string): Promise<string | null> {
  return page.locator('svg text').evaluateAll((nodes, expected) => {
    const node = nodes.find(candidate => {
      if (!candidate.textContent?.includes(expected)) return false;
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return node?.getAttribute('fill') ?? null;
  }, text);
}

test.describe('sankey-svg interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sankey-svg');
    await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30_000 });
  });

  test('offset controls keep the graph in view', async ({ page }) => {
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('recipient-offset-next').click();
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('reset-viewport').click();
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('recipient-offset-prev').click();
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
  });

  test('zoom controls keep rendered nodes available', async ({ page }) => {
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-out').click();

    await expect(page.getByTestId('sankey-node')).not.toHaveCount(0);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
  });

  test('search box and results resize with the base font size', async ({ page }) => {
    const recipientName = '国立研究開発法人新エネルギー・産業技術総合開発機構';
    const projectName = 'GX分野のディープテック・スタートアップ支援事業';
    const beforeWidth = await page.getByTestId('search-input').evaluate(input =>
      input.closest('[data-pan-disabled="true"]')?.getBoundingClientRect().width ?? 0
    );

    await page.getByLabel('表示設定を開く').click();
    await page.getByLabel('基準フォントサイズ編集を開始').click();
    await page.getByLabel('基準フォントサイズ(数値)').fill('24');
    await page.getByLabel('基準フォントサイズ(数値)').press('Enter');

    const afterWidth = await page.getByTestId('search-input').evaluate(input =>
      input.closest('[data-pan-disabled="true"]')?.getBoundingClientRect().width ?? 0
    );
    expect(afterWidth).toBeGreaterThan(beforeWidth);

    await page.getByTestId('search-input').fill('年金');
    const firstResult = page.getByTestId('search-result').first();
    await expect(firstResult).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => firstResult.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    await page.getByTestId('search-input').fill(projectName);
    const projectSearchResult = page.getByTestId('search-result').filter({
      has: page.locator(`[title="${projectName}"]`),
    }).first();
    await expect(projectSearchResult).toBeVisible({ timeout: 30_000 });
    await expect(projectSearchResult.getByText(/PID:7096/)).toBeVisible();

    await page.getByTestId('search-input').fill(recipientName);
    await selectSearchResultByTitle(page, recipientName);
    const panelProject = page.locator('button').filter({
      has: page.locator(`[title="${projectName}"]`),
    }).first();
    await expect(panelProject).toBeVisible({ timeout: 30_000 });
    await expect(panelProject.getByText(/PID:7096/)).toBeVisible();
    await expect.poll(() => panelProject.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test('project side panel uses the unified project badge from graph and search selection', async ({ page }) => {
    const projectName = '燃料油価格激変緩和対策事業';

    await page.locator('svg text').filter({ hasText: projectName }).first().click();
    await expect(page.getByText('事業', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('事業（予算）')).toHaveCount(0);
    await expect(page.getByText('事業（支出）')).toHaveCount(0);

    await page.getByTestId('search-input').fill(projectName);
    await selectSearchResultByTitle(page, projectName);
    await expect(page).toHaveURL(/sel=project-budget-/);
    await expect(page).not.toHaveURL(/sel=project-spending-/);
    await expect(page.getByText('事業', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('事業（予算）')).toHaveCount(0);
    await expect(page.getByText('事業（支出）')).toHaveCount(0);
  });

  test('aggregate nodes leave room for the previous TopN label', async ({ page }) => {
    const gaps = await aggregateBoundaryGaps(page);
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6);
  });

  test('hover highlight does not leak through aggregate project nodes', async ({ page }) => {
    const ministryName = '警察庁';
    const unrelatedRecipientName = '年金受給者';

    await expect(page.locator('svg text').filter({ hasText: ministryName }).first()).toBeVisible();
    await expect(page.locator('svg text').filter({ hasText: unrelatedRecipientName }).first()).toBeVisible();

    await page.locator('svg text').filter({ hasText: ministryName }).first().hover();
    await expect.poll(() => visibleSvgTextFill(page, ministryName), { timeout: 5_000, intervals: [100] }).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, unrelatedRecipientName), { timeout: 5_000, intervals: [100] }).toBe('#bbb');

    await page.locator('svg text').filter({ hasText: unrelatedRecipientName }).first().hover();
    await expect.poll(() => visibleSvgTextFill(page, unrelatedRecipientName), { timeout: 5_000, intervals: [100] }).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, ministryName), { timeout: 5_000, intervals: [100] }).toBe('#bbb');
  });

  test('selected highlight follows aggregate nodes without leaking to unrelated ministries', async ({ page }) => {
    const ministryName = '警察庁';
    const recipientName = '年金受給者';
    const aggregateProjectLabel = '5,744事業';
    const aggregateRecipientLabel = '12,741支出先';

    await page.goto('/sankey-svg?fmc=0');
    await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30_000 });

    await page.locator('svg text').filter({ hasText: ministryName }).first().click();
    await expect.poll(() => visibleSvgTextFill(page, ministryName)).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, aggregateProjectLabel)).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, aggregateRecipientLabel)).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, recipientName)).toBe('#bbb');

    await page.locator('svg text').filter({ hasText: recipientName }).first().click();
    await expect.poll(() => visibleSvgTextFill(page, recipientName)).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, aggregateProjectLabel)).toBe('#333');
    await expect.poll(() => visibleSvgTextFill(page, ministryName)).toBe('#bbb');
  });

  test('year selector can switch fiscal years', async ({ page }) => {
    await page.getByTestId('year-select').selectOption('2024');

    await expect(page.getByTestId('year-select')).toHaveValue('2024');
    await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
  });

  test('debug scenario: select post-5G project, select NEDO recipient, filter project text, and switch year', async ({ page }) => {
    const projectName = 'ポスト5G情報通信システム基盤強化研究開発事業(AI基盤モデル及び先端半導体関連技術開発事業)';
    const recipientName = '国立研究開発法人新エネルギー・産業技術総合開発機構';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.getByTestId('search-input').fill(projectName);
    await selectSearchResultByTitle(page, projectName);
    await expect(page).toHaveURL(/sel=project-budget-3522/);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('search-input').fill(recipientName);
    await selectSearchResultByTitle(page, recipientName);
    await expect(page).toHaveURL(/sel=r-10/);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('search-input').fill('ポスト');
    await page.getByTestId('search-mode-toggle').click();
    await page.getByTestId('filter-target-select').selectOption('project');
    await page.getByTestId('year-select').selectOption('2024');

    await expect(page.getByTestId('search-input')).toHaveValue('ポスト');
    await expect(page.getByTestId('filter-target-select')).toHaveValue('project');
    await expect(page.getByTestId('year-select')).toHaveValue('2024');
    await expect(page).toHaveURL(/yr=2024/);
    await expect(page).toHaveURL(/sel=r-6/);
    await expect(page.getByTestId('sankey-node')).not.toHaveCount(0);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('year-select').selectOption('2025');
    await expect(page.getByTestId('year-select')).toHaveValue('2025');
    await expect(page).toHaveURL(/sel=r-10/);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('selecting a project from the side panel focuses the rendered project', async ({ page }) => {
    const recipientName = '国立研究開発法人新エネルギー・産業技術総合開発機構';
    const projectName = 'GX分野のディープテック・スタートアップ支援事業';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.getByTestId('search-input').fill(recipientName);
    await selectSearchResultByTitle(page, recipientName);
    await expect(page).toHaveURL(/sel=r-10/);

    const panelProject = page.locator('button').filter({
      has: page.locator(`[title="${projectName}"]`),
    }).first();
    await expect(panelProject).toBeVisible({ timeout: 30_000 });
    await expect(panelProject).toContainText('対象支出');
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBe(0);
    await panelProject.click();

    await expect(page).toHaveURL(/sel=project-budget-7096/);
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('selecting a zero-value Digital Agency project from the side panel renders and focuses it', async ({ page }) => {
    const ministryName = 'デジタル庁';
    const projectName = '電子的な属性証明の活用推進における要件等の策定業務';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.locator('svg text').filter({ hasText: ministryName }).first().click();
    await expect(page).toHaveURL(/fm=%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);

    const panelProject = page.locator('button').filter({
      has: page.locator(`[title="${projectName}"]`),
    }).first();
    await expect(panelProject).toBeVisible({ timeout: 30_000 });
    await panelProject.scrollIntoViewIfNeeded();
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBe(0);
    await panelProject.click();

    await expect(page).toHaveURL(/sel=project-budget-22144/);
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('project offset mode uses the filtered project rank when selecting a Digital Agency project', async ({ page }) => {
    const ministryName = 'デジタル庁';
    const projectName = '電子調達システム(情報通信技術調達等適正・効率化推進費)';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.locator('svg text').filter({ hasText: ministryName }).first().click();
    await expect(page).toHaveURL(/fm=%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);

    await page.getByTestId('offset-target-select').selectOption('project');
    await expect(page.getByTestId('offset-target-select')).toHaveValue('project');

    const panelProject = page.locator('button').filter({
      has: page.locator(`[title="${projectName}"]`),
    }).first();
    await expect(panelProject).toBeVisible({ timeout: 30_000 });
    await panelProject.scrollIntoViewIfNeeded();
    await panelProject.click();

    await expect(page).toHaveURL(/sel=project-budget-5550/);
    await expect(page.getByTestId('offset-target-select')).toHaveValue('project');
    await expect(page).not.toHaveURL(/ot=r/);
    await expect(page).not.toHaveURL(/po=4783/);
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('recipient offset mode recenters on the filtered representative recipient for a Digital Agency project', async ({ page }) => {
    const ministryName = 'デジタル庁';
    const projectName = '電子調達システム(情報通信技術調達等適正・効率化推進費)';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.locator('svg text').filter({ hasText: ministryName }).first().click();
    await expect(page).toHaveURL(/fm=%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);

    await page.getByTestId('offset-target-select').selectOption('recipient');
    await expect(page.getByTestId('offset-target-select')).toHaveValue('recipient');
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('recipient-offset-next').click();
    }
    await expect(page).toHaveURL(/ot=r/);
    await expect(page).toHaveURL(/ro=10/);
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBe(0);

    const panelProject = page.locator('button').filter({
      has: page.locator(`[title="${projectName}"]`),
    }).first();
    await expect(panelProject).toBeVisible({ timeout: 30_000 });
    await panelProject.scrollIntoViewIfNeeded();
    await panelProject.click();

    await expect(page).toHaveURL(/sel=project-budget-5550/);
    await expect(page).toHaveURL(/pp=project-spending-5550/);
    await expect(page).not.toHaveURL(/ro=10/);
    await expect.poll(() => visibleSvgTextMatching(page, projectName)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('clicking an already-filtered ministry keeps the ministry filter and shows its side panel', async ({ page }) => {
    const ministryName = 'デジタル庁';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.locator('svg text').filter({ hasText: ministryName }).first().click();
    await expect(page).toHaveURL(/sel=ministry-%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);
    await expect(page).toHaveURL(/fm=%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);

    await page.getByTitle('パネルを折りたたむ').click();
    await page.locator('svg text').filter({ hasText: ministryName }).first().click();
    await page.getByTitle('パネルを展開').click();

    await expect(page).toHaveURL(/fm=%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);
    await expect(page).toHaveURL(/sel=ministry-%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81/);
    await expect(page.getByText(ministryName).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /省庁/ }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe('sankey-svg deep links', () => {
  test('filtered deep link restores year, filter target, selection, and visible graph', async ({ page }) => {
    const recipientName = '国立研究開発法人新エネルギー・産業技術総合開発機構';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/sankey-svg?yr=2024&f=1&nft=p&nf=%E3%83%9D%E3%82%B9%E3%83%88&sel=r-6');

    await expect(page.getByTestId('year-select')).toHaveValue('2024');
    await expect(page.getByTestId('search-input')).toHaveValue('ポスト');
    await expect(page.getByTestId('filter-target-select')).toHaveValue('project');
    await expect(page).toHaveURL(/sel=r-6/);
    await expect(page.getByText(recipientName).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sankey-node')).not.toHaveCount(0);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });
});
