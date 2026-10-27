import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection } from '../app/lib/unified-budget/selection';

test('retains selection when the destination contains the node', () => {
  assert.equal(resolveSelection('project-spending-7', [{ id: 'project-spending-7' }, { id: 'project-budget-7' }]), 'project-spending-7');
});

test('falls back to the same project budget when spending is unavailable', () => {
  assert.equal(resolveSelection('project-spending-7', [{ id: 'project-budget-7' }]), 'project-budget-7');
});

test('clears absent selections without choosing another project', () => {
  assert.equal(resolveSelection('project-budget-7', [{ id: 'project-budget-8' }]), null);
  assert.equal(resolveSelection('project-spending-7', [{ id: 'project-budget-8' }]), null);
  assert.equal(resolveSelection(null, [{ id: 'project-budget-8' }]), null);
});
