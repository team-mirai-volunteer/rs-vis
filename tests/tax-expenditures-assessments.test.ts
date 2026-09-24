import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessments, axes } from '../app/lib/tax-expenditures/assessments';
import { creditSeries } from '../app/lib/tax-expenditures/credits';

test('verification scores count evidenced conditions and missing documents lose points', () => {
  for (const assessment of Object.values(assessments)) {
    assert.equal(assessment.scores.length, axes.length);
    assert.equal(assessment.verification.length, 4);
    assert.equal(assessment.scores[4].score, assessment.verification.filter(v => v.met).length);
    for (const axis of assessment.scores) {
      assert.ok(axis.score === null || (axis.score >= 0 && axis.score <= 4));
      assert.ok(axis.reason.length > 0);
      assert.ok(axis.sources.length > 0);
      for (const source of axis.sources) assert.match(source.url, /^https:\/\/(?:www8?\.(?:cao|mof)\.go\.jp|www\.rieti\.go\.jp)\//);
    }
  }
  assert.equal(assessments['mof-2024-r24'].scores[4].score, 2);
  assert.equal(assessments['mof-2024-r217'].scores[4].score, 2);
});

test('all seven provisions are researched while five evidence gaps remain null', () => {
  assert.equal(assessments['mof-2024-r217'].scores[1].score, 1);
  assert.equal(assessments['mof-2024-r217'].scores[2].score, null);
  const ids = creditSeries('2024').map(s => s.id);
  for (const id of Object.keys(assessments)) assert.ok(ids.includes(id));
  assert.equal(Object.values(assessments).flatMap(a => a.scores).filter(s => s.score !== null).length, 30);
  assert.equal(ids.filter(id => !assessments[id]).length, 0);
});
