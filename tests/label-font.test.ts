import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLabelFontPx, LABEL_FONT_PX_AUTO_MIN, LABEL_FONT_PX_FULL_HD } from '../app/lib/unified-budget/label-font';

test('フル HD 以上では既定の 13px', () => {
  assert.equal(autoLabelFontPx(1920, 1000), LABEL_FONT_PX_FULL_HD);
  assert.equal(autoLabelFontPx(2560, 1300), LABEL_FONT_PX_FULL_HD, '大きい画面でも 13 より大きくしない');
});

test('ノート PC では高さ・幅の比で縮め、下限は 10px', () => {
  assert.equal(autoLabelFontPx(1440, 820), 10, '1440×900（内側 820）: 幅の比 0.758 × 13 = 9.9 → 10');
  assert.equal(autoLabelFontPx(1700, 900), 12, '1700×900: 高さの比 0.9 × 13 = 11.7 → 12');
});

test('小さい画面は下限で止める', () => {
  assert.equal(autoLabelFontPx(1366, 690), LABEL_FONT_PX_AUTO_MIN);
  assert.equal(autoLabelFontPx(1024, 600), LABEL_FONT_PX_AUTO_MIN);
});

test('不正な寸法は既定値', () => {
  assert.equal(autoLabelFontPx(0, 0), LABEL_FONT_PX_FULL_HD);
  assert.equal(autoLabelFontPx(Number.NaN, 900), LABEL_FONT_PX_FULL_HD);
});
