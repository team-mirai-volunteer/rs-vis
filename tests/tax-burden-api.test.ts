import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as parameters } from '../app/api/tax-burden/params/route';
import { GET as revenue } from '../app/api/tax-burden/revenue/route';

test('parameter API declares prototype status and rejects unsupported years', async () => {
  const response = await parameters(new NextRequest('http://localhost/api/tax-burden/params?fy=2025'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).metadata.status, 'prototype');
  assert(response.headers.get('cache-control')?.includes('s-maxage'));
  assert.equal((await parameters(new NextRequest('http://localhost/api/tax-burden/params?fy=2024'))).status, 400);
});

test('revenue API serves all ten validated years and rejects malformed inputs', async () => {
  for (let year = 2017; year <= 2026; year++) {
    const response = await revenue(new NextRequest(`http://localhost/api/tax-burden/revenue?fy=${year}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.metadata.fiscalYear, year);
    assert.equal(body.total, body.stamp + body.taxes.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0));
  }
  for (const year of ['2025abc', '2027', '../2025', 'NaN']) {
    assert.equal((await revenue(new NextRequest(`http://localhost/api/tax-burden/revenue?fy=${year}`))).status, 400);
  }
});
