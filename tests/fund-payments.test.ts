import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFundPayments } from '../app/lib/api/fund-payments-loader';
import { loadFunds } from '../app/lib/api/funds-loader';
import { normalizeRecipientName } from '../app/lib/recipient-key';

const payments = loadFundPayments();
const funds = loadFunds();

test('基金の支出先: どの基金も funds.json にあり、「基金自身」は保有法人だけが受け取るグループ', { skip: !payments || !funds }, () => {
  const byKey = new Map(funds!.funds.map(f => [f.key, f]));
  let selfGroups = 0;
  for (const [key, years] of Object.entries(payments!.funds)) {
    const fund = byKey.get(key);
    assert.ok(fund, `funds.json に無い基金 ${key}`);
    for (const groups of Object.values(years)) for (const g of groups) {
      assert.ok(g.payees.length > 0 || !g.self);
      if (g.self) {
        selfGroups++;
        const owner = normalizeRecipientName(fund!.owner);
        for (const p of g.payees) assert.ok(normalizeRecipientName(p.name).endsWith(owner), `${p.name} は保有法人 ${fund!.owner} ではない`);
      }
    }
  }
  assert.ok(selfGroups > 0);
});
