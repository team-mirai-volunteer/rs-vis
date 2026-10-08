import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avgSingleBidRate, emptyVendorYear, fromVendorRow, matchVendor, nonCompetitiveShare, singleBidRatio, sortVendors, toVendorRow, vendorKindGroup, vendorSignals,
} from '../app/lib/vendors';
import type { Vendor, VendorYear } from '../types/vendors';

const year = (over: Partial<VendorYear>): VendorYear => ({ ...emptyVendorYear(2025), ...over });
const vendor = (over: Partial<Vendor>, total: Partial<VendorYear> = {}): Vendor => ({
  key: '1234567890123', name: '株式会社テスト', corporateNumber: '1234567890123', kind: '301', years: [], total: year({ sheetYear: 0, ...total }),
  ministries: [{ ministry: 'A省', amount: 100, projects: 2 }], repeatSingle: [], repeatSingleCount: 0, repeatSoleCount: 0, ...over,
});

test('1者応札率・落札率の平均・競争を経ない割合', () => {
  const t = year({ contractAmount: 1000, competitiveWithApplicants: 10, singleCount: 6, singleAmount: 300, soleAmount: 200, singleBidRateSum: 285, singleBidRateN: 3 });
  assert.equal(singleBidRatio(t), 60);
  assert.equal(avgSingleBidRate(t), 95);
  assert.equal(nonCompetitiveShare(t), 50);
  assert.equal(singleBidRatio(year({})), null, '応札者数の記載が無ければ率を出さない');
  assert.equal(nonCompetitiveShare(year({})), null);
});

test('論点の判定', () => {
  const v = vendor({ repeatSingleCount: 2, repeatSoleCount: 1 },
    { contractAmount: 1000, competitiveWithApplicants: 5, singleCount: 3, soleAmount: 600, singleBidRateSum: 288, singleBidRateN: 3, ministries: 3 });
  assert.deepEqual(vendorSignals(v), ['singleMajority', 'repeatSingle', 'soleMajor', 'repeatSole', 'highBidRate', 'multiMinistry']);
  assert.deepEqual(vendorSignals(vendor({}, { contractAmount: 100, competitiveWithApplicants: 4, singleCount: 4 })), [], '競争入札が5件未満なら1者過半は付けない');
});

test('並べ替えは記載なし（null）を末尾に、同点は契約額の大きい順', () => {
  const a = vendor({ key: 'a', name: 'a' }, { contractAmount: 10, competitiveWithApplicants: 4, singleCount: 2 });
  const b = vendor({ key: 'b', name: 'b' }, { contractAmount: 20, competitiveWithApplicants: 2, singleCount: 2 });
  const c = vendor({ key: 'c', name: 'c' }, { contractAmount: 30, competitiveWithApplicants: 4, singleCount: 2 });
  assert.deepEqual(sortVendors([a, b, c], 'singleRatio', true).map(v => v.key), ['c', 'a', 'b'], '3件未満は率を出さず末尾');
  assert.deepEqual(sortVendors([a, b, c], 'name', false).map(v => v.key), ['a', 'b', 'c']);
});

test('一覧の行への詰め込みと復元', () => {
  const v = vendor({ repeatSingleCount: 3 }, { contractAmount: 500, singleAmount: 50, projects: 4, ministries: 2 });
  const back = fromVendorRow(toVendorRow(v));
  assert.equal(back.total.contractAmount, 500);
  assert.equal(back.total.singleAmount, 50);
  assert.equal(back.total.projects, 4);
  assert.equal(back.repeatSingleCount, 3);
  assert.equal(back.ministries[0].ministry, 'A省');
});

test('名前・法人番号の検索と法人種別の区分', () => {
  assert.ok(matchVendor({ name: '富士通株式会社', corporateNumber: '1020001071491' }, 'ふじつう') === false);
  assert.ok(matchVendor({ name: '富士通株式会社', corporateNumber: '1020001071491' }, '富士通'));
  assert.ok(matchVendor({ name: '富士通株式会社', corporateNumber: '1020001071491' }, '10200010'));
  assert.ok(matchVendor({ name: 'ＮＴＴデータ', corporateNumber: '' }, 'ntt'), 'NFKC と小文字化で全角英字も引ける');
  assert.equal(vendorKindGroup('301'), 'company');
  assert.equal(vendorKindGroup('399'), 'other');
  assert.equal(vendorKindGroup('101'), 'public');
  assert.equal(vendorKindGroup(undefined), 'unknown');
});
