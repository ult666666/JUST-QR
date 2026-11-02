import { defineConfig } from '@playwright/test';

// QR_TEST_PORT lets parallel local runs use different ports; CI uses the default.
const port = Number(process.env.QR_TEST_PORT ?? 8096);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  expect: { timeout: 3000 },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
