import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractHistory, historyYearLabel } from '../app/lib/contract-history';
import type { ContractMethodEntry, ContractMethodsByPid } from '../app/lib/contract-method';

const CN = '1234567890123';
const c = (n: string, cn: string, a: number, m: ContractMethodEntry['m'], ap?: number): ContractMethodEntry =>
  ({ b: 'A', n, cn, a, m, ...(ap !== undefined ? { ap } : {}) });

const methods: Record<string, ContractMethodsByPid> = {
  '2024': {
    1: [c('株式会社テスト', CN, 100, 'negotiated-contract-others', 1)],
    2: [c('株式会社テスト', CN, 50, 'negotiated-contract-public-offering')],
    3: [c('株式会社テスト', CN, 10, 'negotiated-contract-small-amount')],
    4: [c('別会社', '9999999999999', 999, 'negotiated-contract-others')],
  },
  '2025': {
    1: [c('(株)テスト', '', 120, 'negotiated-contract-others')],
    2: [c('株式会社テスト', CN, 60, 'open-tendering-lowest-price', 1)],
    3: [c('株式会社テスト', CN, 10, 'negotiated-contract-small-amount')],
    4: [c('別会社', '9999999999999', 999, 'negotiated-contract-others')],
  },
  '2026': {
    1: [c('株式会社テスト', CN, 130, 'negotiated-contract-others'), c('株式会社テスト', CN, 5, 'negotiated-contract-small-amount')],
    2: [c('株式会社テスト', CN, 70, 'negotiated-contract-competitive-bidding')],
    3: [c('株式会社テスト', CN, 10, 'negotiated-contract-small-amount')],
  },
};

test('年度ラベル: シート2026は2025年度（暫定）', () => {
  assert.equal(historyYearLabel('2024'), '2023年度');
  assert.equal(historyYearLabel('2026'), '2025年度（暫定）');
});

test('法人番号で年度をまたいで集め、随意契約が2年度以上続く事業を拾う（少額は数えない）', () => {
  const h = buildContractHistory(CN, ['株式会社テスト'], methods, pid => (pid === '1' ? { name: '事業1', ministry: 'A省' } : undefined))!;
  assert.deepEqual(h.years.map(y => [y.sheetYear, y.count, y.singleBidder]), [['2024', 3, 1], ['2025', 3, 1], ['2026', 4, 0]]);
  assert.deepEqual(h.years[1].methods.map(m => m.category), ['negotiated-sole', 'open', 'negotiated-small']);
  assert.deepEqual(h.continuing.map(p => [p.pid, p.negotiatedYears, p.allSole, p.negotiatedAmount]), [['1', 3, true, 350], ['2', 2, false, 120]]);
  assert.equal(h.continuingCount, 2);
  assert.equal(h.continuingAllSoleCount, 1);
  assert.equal(h.continuing[0].name, '事業1');
  assert.equal(h.continuing[0].ministry, 'A省');
  assert.equal(h.continuing[1].name, undefined);
  // 番号の無い記載は表記ゆれの名前で拾う
  assert.equal(h.continuing[0].years[1].soleAmount, 120);
  assert.deepEqual(h.continuing[0].years[2], { sheetYear: '2026', soleAmount: 130, soleCount: 1, negotiatedCompetitiveAmount: 0,
    negotiatedCompetitiveCount: 0, otherAmount: 5, otherCount: 1, singleBidder: 0, projectListed: true });
  assert.equal(h.continuing[1].years[1].otherAmount, 60);
  assert.equal(h.continuing[1].years[1].singleBidder, 0, '1者応札は随意契約の分だけ数える');
});

test('事業が無い年度・ファイルが無い年度を区別し、上位だけ返す', () => {
  const h = buildContractHistory(CN, [], { '2024': methods['2024'], '2025': { 1: methods['2025'][1].map(e => ({ ...e, cn: CN })) } }, undefined, 1)!;
  assert.equal(h.years[2].available, false);
  assert.equal(h.continuing.length, 1);
  assert.equal(h.continuingCount, 1);
  assert.equal(h.continuing[0].years[2].projectListed, false);
});

test('法人番号が無ければ名前だけで拾い、名前も無ければ null', () => {
  const h = buildContractHistory('', ['株式会社テスト'], methods)!;
  assert.equal(h.continuing[0].years[1].soleAmount, 120);
  assert.equal(buildContractHistory('', [], methods), null);
});
