import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipientProfile, genericRecipientNote } from '../app/lib/recipient-profile';
import type { RecipientEntry } from '../types/recipient-index';

test('集合的な記載（その他・受給者・自治体の一括・伏せ字の個人）を見分ける', () => {
  assert.ok(genericRecipientNote('その他'));
  assert.ok(genericRecipientNote('年金受給者等'));
  assert.ok(genericRecipientNote('都道府県'));
  assert.ok(genericRecipientNote('個人A'));
  assert.equal(genericRecipientNote('富士通株式会社'), undefined);
  assert.equal(genericRecipientNote('横浜市'), undefined);
});

test('契約は法人番号で集め、支出元の事業に限る', () => {
  const entry = {
    key: '1234567890123', name: '株式会社テスト', corporateNumber: '1234567890123', aliases: ['株式会社テスト', '(株)テスト'],
    totals: { directAmount: 300, directCount: 2, subcontractAmount: 50, subcontractCount: 1 },
    byMinistry: [{ ministry: 'A省', directAmount: 300, subcontractAmount: 50, projectCount: 2 }],
    appearances: [{ pid: 1 }, { pid: 2 }],
  } as unknown as RecipientEntry;
  const profile = buildRecipientProfile('株式会社テスト', entry, {
    1: [{ b: 'A', n: '株式会社テスト', cn: '1234567890123', a: 100, m: 'negotiated-contract-others', ap: 1 }],
    2: [{ b: 'A', n: '別表記', cn: '1234567890123', a: 200, m: 'open-tendering-lowest-price', ap: 3 },
      { b: 'B', n: '別会社', cn: '9999999999999', a: 999, m: 'subsidy' }],
    3: [{ b: 'A', n: '株式会社テスト', cn: '1234567890123', a: 5000, m: 'subsidy' }],
  });
  assert.equal(profile.entry?.projectCount, 2);
  assert.deepEqual(profile.entry?.aliases, ['(株)テスト']);
  assert.deepEqual(profile.entry?.byMinistry, [{ ministry: 'A省', amount: 350, projectCount: 2 }]);
  assert.deepEqual(profile.methods, [
    { category: 'open', amount: 200, count: 1, singleBidder: 0 },
    { category: 'negotiated-sole', amount: 100, count: 1, singleBidder: 1 },
  ]);
});

test('支出先インデックスに無ければ説明だけ返す', () => {
  assert.deepEqual(buildRecipientProfile('その他', null, null), { name: 'その他', genericNote: genericRecipientNote('その他'), methods: [] });
});
