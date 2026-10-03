import test from 'node:test';
import assert from 'node:assert/strict';
import { apiContractMethod, contractCategory, contractLines, findContract, type ContractMethodEntry } from '../app/lib/contract-method';

const e = (over: Partial<ContractMethodEntry>): ContractMethodEntry => ({ b: 'A', n: '株式会社テスト', cn: '', a: 100, m: 'negotiated-contract-others', ...over });

test('随意契約は競争の有無で分け、補助金等は契約以外にする', () => {
  assert.equal(contractCategory('negotiated-contract-others'), 'negotiated-sole');
  assert.equal(contractCategory('negotiated-contract-unsuccessful'), 'negotiated-sole');
  assert.equal(contractCategory('negotiated-contract-competitive-bidding'), 'negotiated-competitive');
  assert.equal(contractCategory('open-tendering-comprehensive-evaluation'), 'open');
  assert.equal(contractCategory('subsidy'), 'non-contract');
});

test('支出行はブロック・名前で引き、複数あれば金額で絞る', () => {
  const entries = [e({ a: 100, m: 'open-tendering-lowest-price' }), e({ a: 200 }), e({ b: 'B', a: 100, m: 'subsidy' })];
  assert.equal(findContract(entries, { b: 'A', n: '株式会社テスト', a2: 200 })?.m, 'negotiated-contract-others');
  assert.equal(findContract(entries, { b: 'A', n: '株式会社 テスト', a2: 100 })?.m, 'open-tendering-lowest-price');
  assert.equal(findContract(entries, { b: 'B', n: '株式会社テスト', a2: 999 })?.m, 'subsidy');
  assert.equal(findContract(entries, { b: 'C', n: '株式会社テスト', a2: 100 }), null);
});

test('金額で決まらず方式も割れるときは推測しない', () => {
  const entries = [e({ a: 100, m: 'open-tendering-lowest-price' }), e({ a: 200 })];
  assert.equal(findContract(entries, { b: 'A', n: '株式会社テスト', a2: 300 }), null);
  const same = [e({ a: 100 }), e({ a: 200 })];
  assert.equal(findContract(same, { b: 'A', n: '株式会社テスト', a2: 300 })?.m, 'negotiated-contract-others');
});

test('契約の行は同じ概要・同じ方式を1行にまとめ、概要も方式も無い行は落とす', () => {
  assert.deepEqual(contractLines([
    { text: '広報業務', m: 'negotiated-contract-others', ap: 1 },
    { text: ' 広報業務 ', m: 'negotiated-contract-others', ap: 1 },
    { text: '広報業務', m: 'open-tendering-lowest-price' },
    { text: '', m: 'subsidy' },
    { text: '' },
    { text: '印刷' },
  ]), [
    { text: '広報業務', m: 'negotiated-contract-others', ap: 1 },
    { text: '広報業務', m: 'open-tendering-lowest-price' },
    { text: '', m: 'subsidy' },
    { text: '印刷' },
  ]);
});

test('API の契約から方式を取り出し、埋め草の補足と範囲外の落札率は落とす', () => {
  assert.deepEqual(apiContractMethod({ contract_method: 'negotiated-contract-others', contract_method_description: '特命随意契約', number_of_applicants: 1, bid_rate: 99.5 }),
    { m: 'negotiated-contract-others', mt: '特命随意契約', ap: 1, br: 99.5 });
  assert.deepEqual(apiContractMethod({ contract_method: 'others', contract_method_description: '－', bid_rate: 999 }), { m: 'others' });
  assert.equal(apiContractMethod({ contract_method: null }), null);
  assert.equal(apiContractMethod({ contract_method: 'unknown-method' }), null);
});
