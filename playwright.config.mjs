import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: 'http://127.0.0.1:8096',
    headless: true,
    trace: 'retain-on-failure',
  },
  expect: { timeout: 3000 },
  webServer: {
    command: 'python3 -m http.server 8096 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8096',
    reuseExistingServer: false,
  },
});
