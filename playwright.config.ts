import { defineConfig } from '@playwright/test';

/**
 * E2E テスト設定（tests/e2e/）。
 * dev サーバーが起動済みならそれを使い、なければ自動起動する。
 * ブラウザ未インストール環境では PLAYWRIGHT_CHANNEL=chrome でシステムの Chrome を使える。
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const production = process.env.PLAYWRIGHT_PRODUCTION === '1' || !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next ${production ? 'start' : 'dev --turbopack'} --port ${new URL(baseURL).port || '3000'}`,
    url: baseURL,
    reuseExistingServer: !production,
    timeout: 120_000,
  },
});
