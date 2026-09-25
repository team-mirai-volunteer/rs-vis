import assert from 'node:assert/strict';
import test from 'node:test';
import { recipientContractsInProject } from '../app/lib/recipient-contracts';

const recipient = (name: string, amount: number, contractSummaries: string[]) => ({
  name, corporateNumber: '', amount, contractSummaries, expenses: [],
});
const graph = {
  projectId: 1335,
  projectName: '在外公館施設',
  blocks: [
    { recipients: [recipient('個人A', 818647000, ['在クロアチア日本国大使公邸の不動産購入']), recipient('個人B', 236300000, ['在ボリビア日本国大使館事務所の不動産購入'])] },
    { recipients: [recipient('個人A', 1000, ['在クロアチア日本国大使公邸の不動産購入', '登記手数料'])] },
  ],
} as unknown as Parameters<typeof recipientContractsInProject>[0];

test('collects contracts for an exact recipient name across blocks, without duplicates', () => {
  assert.deepEqual(recipientContractsInProject(graph, '個人A'), {
    pid: 1335,
    projectName: '在外公館施設',
    amount: 818648000,
    contracts: ['在クロアチア日本国大使公邸の不動産購入', '登記手数料'],
  });
});

test('does not mix a different masked recipient and returns null when absent', () => {
  assert.deepEqual(recipientContractsInProject(graph, '個人B')?.contracts, ['在ボリビア日本国大使館事務所の不動産購入']);
  assert.equal(recipientContractsInProject(graph, '個人C'), null);
});
