import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:8789',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node scripts/browser-server.mjs',
    url: 'http://127.0.0.1:8789',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
