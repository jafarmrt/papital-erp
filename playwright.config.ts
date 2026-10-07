import { defineConfig, devices } from '@playwright/test';

/**
 * v7.0.77 (audit P3-7): یک مسیر حیاتی سرتاسری در مرورگر — ورود، صدور فاکتور فروش، دیدن سند حسابداری آن.
 * سرور باندل پروداکشن (`npm run build` → dist/server.cjs) روی پایگاه‌داده خالی E2E_DATABASE_URL اجرا می‌شود؛
 * مهاجرت و seed در شروع سرور و مدیر سیستم از مسیر راه‌اندازی اولیه (e2e/global-setup.ts) ساخته می‌شوند.
 */
const PORT = Number(process.env.E2E_PORT || 3100);
export const E2E_BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E_BASE_URL,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
  webServer: {
    command: 'node dist/server.cjs',
    // startup (نه ready): ۲۰۰ فقط پس از پایان مهاجرت و seed پس‌زمینه
    url: `${E2E_BASE_URL}/health/startup`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: process.env.E2E_DATABASE_URL || '',
      JWT_SECRET: process.env.E2E_JWT_SECRET || 'e2e-jwt-secret-at-least-32-characters-long-123',
      ERP_SETUP_TOKEN: process.env.E2E_SETUP_TOKEN || 'e2e_setup_token_at_least_16_chars',
    },
  },
});
