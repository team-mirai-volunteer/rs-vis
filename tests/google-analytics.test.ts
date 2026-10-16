import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GA_MEASUREMENT_ID,
  googleAnalyticsMeasurementId,
  isProductionAnalytics,
  shouldLoadGoogleAnalytics,
} from '../app/lib/google-analytics';

test('測定 ID は環境変数、空や不正なら既定の G-R7STTQBRZJ', () => {
  assert.equal(DEFAULT_GA_MEASUREMENT_ID, 'G-R7STTQBRZJ');
  assert.equal(googleAnalyticsMeasurementId(undefined), DEFAULT_GA_MEASUREMENT_ID);
  assert.equal(googleAnalyticsMeasurementId(''), DEFAULT_GA_MEASUREMENT_ID);
  assert.equal(googleAnalyticsMeasurementId('   '), DEFAULT_GA_MEASUREMENT_ID);
  assert.equal(googleAnalyticsMeasurementId('not-a-measurement-id'), DEFAULT_GA_MEASUREMENT_ID);
  assert.equal(googleAnalyticsMeasurementId('G-CUSTOM1'), 'G-CUSTOM1');
  assert.equal(googleAnalyticsMeasurementId('  G-R7STTQBRZJ  '), 'G-R7STTQBRZJ');
});

test('VERCEL_ENV が production のときだけ計測する', () => {
  assert.equal(isProductionAnalytics('production'), true);
  assert.equal(isProductionAnalytics('preview'), false);
  assert.equal(isProductionAnalytics('development'), false);
  assert.equal(isProductionAnalytics(undefined), false);
  assert.equal(isProductionAnalytics(''), false);
});

test('/admin ではタグを読み込まない', () => {
  assert.equal(shouldLoadGoogleAnalytics('/'), true);
  assert.equal(shouldLoadGoogleAnalytics('/budget-sankey'), true);
  assert.equal(shouldLoadGoogleAnalytics('/privacy'), true);
  assert.equal(shouldLoadGoogleAnalytics('/administration'), true);
  assert.equal(shouldLoadGoogleAnalytics('/admin'), false);
  assert.equal(shouldLoadGoogleAnalytics('/admin/'), false);
  assert.equal(shouldLoadGoogleAnalytics('/admin/comments'), false);
  assert.equal(shouldLoadGoogleAnalytics(null), false);
});

test('CSP が Google タグのスクリプトと送信先を許可する', () => {
  const configPath = join(dirname(fileURLToPath(import.meta.url)), '../next.config.ts');
  const config = readFileSync(configPath, 'utf8');

  function directive(name: string): string {
    const match = config.match(new RegExp(`"${name} ([^"]*)"`));
    assert.ok(match, `${name} ディレクティブ`);
    return match[1];
  }

  const script = directive('script-src');
  assert.match(script, /'self'/);
  assert.match(script, /'unsafe-inline'/);
  assert.match(script, /https:\/\/www\.googletagmanager\.com/);

  const connect = directive('connect-src');
  assert.match(connect, /'self'/);
  assert.match(connect, /https:\/\/openrouter\.ai/);
  assert.match(connect, /https:\/\/www\.google-analytics\.com/);
  assert.match(connect, /https:\/\/\*\.google-analytics\.com/);
  assert.match(connect, /https:\/\/analytics\.google\.com(?!\/)/);
  assert.match(connect, /https:\/\/\*\.analytics\.google\.com/);
  assert.match(connect, /https:\/\/www\.googletagmanager\.com/);

  const img = directive('img-src');
  assert.match(img, /'self'/);
  assert.match(img, /data:/);
  assert.match(img, /https:\/\/www\.google-analytics\.com/);
  assert.match(img, /https:\/\/\*\.google-analytics\.com/);
  assert.match(img, /https:\/\/analytics\.google\.com/);
  assert.match(img, /https:\/\/\*\.analytics\.google\.com/);
  assert.match(img, /https:\/\/www\.googletagmanager\.com/);
});
