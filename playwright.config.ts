import { defineConfig } from '@playwright/test';

/**
 * E2E テスト設定（tests/e2e/）。
 * dev サーバーが起動済みならそれを使い、なければ自動起動する。
 * ブラウザ未インストール環境では PLAYWRIGHT_CHANNEL=chrome でシステムの Chrome を使える。
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --turbopack --port ${new URL(baseURL).port || '3000'}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
