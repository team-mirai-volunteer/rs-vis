import assert from 'node:assert/strict';
import test from 'node:test';
import { SCORE_BANDS, scoreBand, scoreColor } from '../client/components/quality/score-format';

test('score bands switch exactly at 90 / 70 / 50', () => {
  assert.equal(scoreBand(100), SCORE_BANDS[0]);
  assert.equal(scoreBand(90), SCORE_BANDS[0]);
  assert.equal(scoreBand(89.9), SCORE_BANDS[1]);
  assert.equal(scoreBand(70), SCORE_BANDS[1]);
  assert.equal(scoreBand(69), SCORE_BANDS[2]);
  assert.equal(scoreBand(50), SCORE_BANDS[2]);
  assert.equal(scoreBand(49), SCORE_BANDS[3]);
  assert.equal(scoreBand(0), SCORE_BANDS[3]);
  assert.equal(scoreBand(-5), SCORE_BANDS[3]);
});

test('scoreColor follows the band text color and mutes missing scores', () => {
  assert.equal(scoreColor(null), 'text-mirai-text-muted');
  for (const score of [95, 75, 55, 10]) assert.equal(scoreColor(score), scoreBand(score).text);
});
