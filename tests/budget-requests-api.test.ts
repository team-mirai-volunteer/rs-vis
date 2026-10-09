import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/budget-requests/route';

const get = (query = '') => GET(new NextRequest(`http://localhost/api/budget-requests${query}`));

test('概算要求APIはデータ読み込み前に不正な条件を拒否する', async () => {
  for (const query of ['?fy=2026', '?fy=../2027', '?status=invalid', '?type=invalid', '?amount=invalid', '?page=0', '?limit=500']) {
    const response = await get(query);
    assert.equal(response.status, 400, query);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('概算要求APIは実データの出典・集計範囲を返すか、未収録を明示する', async () => {
  const response = await get('?fy=2027&limit=1');
  const body = await response.json();
  if (response.status === 404) {
    assert.equal(body.code, 'DATA_NOT_AVAILABLE');
    assert.equal('records' in body, false, '未生成を0件の実データに見せない');
    return;
  }
  assert.equal(response.status, 200);
  assert.equal(body.requestedFY, 2027);
  assert.equal(body.metadata.stage, 'request');
  assert.equal(body.metadata.unit, 'JPY');
  assert.ok(body.metadata.notes.some((note: string) => note.includes('成立予算')));
  assert.ok(body.records.length <= 1 && body.documents.length <= 1);
  assert.ok(body.pagination.matchingRecords >= body.records.length);
  assert.ok(body.coverage.discoveredDocuments >= body.documents.length);
  assert.ok(response.headers.get('cache-control')?.includes('s-maxage'));
  assert.equal('totalAmount' in body, false);
});
