import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomicMinistryOptions, isCompoundMinistry, ministryMatches, splitMinistryName } from '../app/lib/unified-budget/ministry-names';

test('splitMinistryName: 「、」と「及び」で分解し、単独名は 1 要素', () => {
  assert.deepEqual(splitMinistryName('内閣府及び厚生労働省'), ['内閣府', '厚生労働省']);
  assert.deepEqual(splitMinistryName('内閣府、総務省及び財務省'), ['内閣府', '総務省', '財務省']);
  assert.deepEqual(splitMinistryName('環境省'), ['環境省']);
  assert.equal(splitMinistryName('国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省').length, 18);
  assert.equal(isCompoundMinistry('財務省及び国土交通省'), true);
  assert.equal(isCompoundMinistry('財務省'), false);
});

test('ministryMatches: 単独名の一致か、共管の構成省庁のいずれかが選ばれていれば含む', () => {
  const selected = new Set(['環境省']);
  assert.equal(ministryMatches(selected, '環境省'), true);
  assert.equal(ministryMatches(selected, '内閣府、文部科学省、経済産業省及び環境省'), true);
  assert.equal(ministryMatches(selected, '内閣府及び厚生労働省'), false);
  assert.equal(ministryMatches(selected, '財務省'), false);
  // 共管名そのものが選ばれている場合（古い共有 URL）も通す
  assert.equal(ministryMatches(new Set(['内閣府及び厚生労働省']), '内閣府及び厚生労働省'), true);
});

test('atomicMinistryOptions: 共管を分解して単独の省庁だけを重複なく並べる', () => {
  const options = atomicMinistryOptions(['内閣府及び厚生労働省', '厚生労働省', '財務省及び国土交通省', '環境省']);
  assert.deepEqual([...options].sort(), ['内閣府', '厚生労働省', '国土交通省', '環境省', '財務省'].sort());
  assert.ok(options.every(o => !isCompoundMinistry(o)));
});
