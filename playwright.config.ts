import { defineConfig } from '@playwright/test';

/**
 * E2E テスト設定（tests/e2e/）。
 * dev サーバーが起動済みならそれを使い、なければ自動起動する。
 * ブラウザ未インストール環境では PLAYWRIGHT_CHANNEL=chrome でシステムの Chrome を使える。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
