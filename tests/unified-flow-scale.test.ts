import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowScale, FLOW_SCALE_BASE } from '../client/lib/unified-flow-scale';

test('new thickness defaults to former 0.5 while explicit shared thickness preserves layout units', () => {
  assert.equal(parseFlowScale(null), 1);
  assert.equal(parseFlowScale(null) * FLOW_SCALE_BASE, .5);
  for (const former of [.25, .5, 1.25, 2.5, 8]) assert.equal(parseFlowScale(String(former)) * FLOW_SCALE_BASE, former);
  for (const invalid of ['', 'NaN', 'Infinity', '-1', '0']) assert.equal(parseFlowScale(invalid), 1);
  assert.equal(parseFlowScale('.55'), 1.1);
  assert.equal(parseFlowScale('999'), 16);
});
