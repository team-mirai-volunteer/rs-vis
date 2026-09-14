import { test, expect } from '@playwright/test';

/**
 * 旧サンキー図 /sankey-svg は統合ビュー /budget-sankey へリダイレクトする。
 * 外部に共有された旧 URL（年度・選択・表示範囲・絞り込み）が統合ビューの語彙に写ることを確認する。
 * 写像の単体テストは tests/unified-budget-links.test.ts。
 */
test.describe('sankey-svg redirect', () => {
  test('bare /sankey-svg lands on the unified view in RS-only preset for 2024', async ({ page }) => {
    await page.goto('/sankey-svg');
    await expect(page).toHaveURL(/\/budget-sankey\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('year')).toBe('2024');
    expect(url.searchParams.get('cols')).toBe('mi,pr,ps,re');
    expect(url.searchParams.get('fnrs')).toBe('0');
  });

  test('old selection, pins, ranges and filters are mapped', async ({ page }) => {
    // 2024 年度の統合グラフ（約 20MB）を読むので長めに取る
    test.setTimeout(240_000);
    await page.goto('/sankey-svg?yr=2025&sel=project-spending-2826&fr=1&tp=60&tr=80&fnp=%E5%B9%B4%E9%87%91&fp=1&z=2');
    await expect(page).toHaveURL(/\/budget-sankey\?/);
    const q = new URL(page.url()).searchParams;
    expect(q.get('year')).toBe('2024');
    expect(q.get('sel')).toBe('project-budget-2826');
    expect(q.get('fr')).toBe('1');
    expect(q.get('tpr')).toBe('60');
    expect(q.get('tps')).toBe('60');
    expect(q.get('tre')).toBe('80');
    expect(q.getAll('fmi')).toEqual([]); // 旧 fm（RS 府省庁）は MOF 所管と体系が違うため写さない
    expect(q.get('fpq')).toBe('年金');
    expect(q.get('ffp')).toBe('1');
    expect(q.get('z')).toBeNull();
    // 統合ビューが実際に描画され、選択した事業がパネルに出る
    await expect(page.getByTestId('unified-canvas')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('unified-side-panel')).toContainText('基礎年金給付に必要な経費', { timeout: 60_000 });
  });
});
