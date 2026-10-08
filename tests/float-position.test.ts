import test from 'node:test';
import assert from 'node:assert/strict';
import { floatPlacement } from '../app/lib/float-position';

const base = { width: 288, height: 150, parentWidth: 1200, parentHeight: 700 };

test('ふだんはポインタの右、少し上に出す', () => {
  const p = floatPlacement({ ...base, x: 300, y: 300 });
  assert.equal(p.side, 'right');
  assert.equal(p.left, 314);
  assert.equal(p.top, 240);
});

test('右端に収まらないときは左に出し、ポインタを隠さない', () => {
  const p = floatPlacement({ ...base, x: 1100, y: 300 });
  assert.equal(p.side, 'left');
  assert.equal(p.left, 1100 - 14 - 288);
});

test('下端では上に寄せ、上端では下に寄せる（左右に出すとき）', () => {
  assert.equal(floatPlacement({ ...base, x: 300, y: 690 }).top, 700 - 150 - 8);
  assert.equal(floatPlacement({ ...base, x: 300, y: 10 }).top, 8);
});

test('狭い画面で左右に収まらないときは、横は端に寄せて縦はポインタの下に出す', () => {
  const narrow = { ...base, parentWidth: 390, parentHeight: 700 };
  const p = floatPlacement({ ...narrow, x: 200, y: 300 });
  assert.equal(p.side, 'below');
  assert.equal(p.top, 314);
  assert.equal(p.left, 390 - 288 - 8);
  assert.ok(p.top > 300, 'フロートの上端がポインタより下');
});

test('狭い画面で下にも収まらないときはポインタの上に出す', () => {
  const narrow = { ...base, parentWidth: 390, parentHeight: 500 };
  const p = floatPlacement({ ...narrow, x: 200, y: 450 });
  assert.equal(p.side, 'above');
  assert.equal(p.top, 450 - 14 - 150);
  assert.ok(p.top + 150 < 450, 'フロートの下端がポインタより上');
});
