import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../.tmp/web-test-results',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4329',
    channel: process.env.OEY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" --import tsx apps/web/src/server/main.ts --project .tmp/browser-test-${Date.now()} --port 4329`,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:4329/api/project',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
