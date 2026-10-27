import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionPan } from '../app/lib/unified-budget/selection-viewport';

test('selection hidden under the details panel moves into the visible canvas', () => {
  const current = { id: 'p', x: 420, y: 12000 };
  const next = selectionPan({ pan: { x: 0, y: 0 }, zoom: 1, current, width: 1440, height: 900, panelWidth: 544 });
  assert.ok(current.x + next.x > 544);
  assert.ok(current.y + next.y < 900);
});
test('offscreen selection moves into view at the current zoom', () => {
  const current = { id: 'p', x: 420, y: 12000 };
  const next = selectionPan({ pan: { x: -3000, y: -4000 }, zoom: 2, current, width: 1440, height: 900, panelWidth: 544 });
  assert.ok(current.x * 2 + next.x > 544);
  assert.ok(current.x * 2 + next.x < 1440);
  assert.ok(current.y * 2 + next.y >= 100);
  assert.ok(current.y * 2 + next.y <= 820);
});
