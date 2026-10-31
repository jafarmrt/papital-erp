import { expect, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/**
 * v11 (owner report 9 Aban 1405): the app showed a blank white page in Firefox. This runs only in the Firefox project
 * (playwright.config.ts): the login page, a sign-in and two pages must render, with no uncaught script error.
 * Each error is printed so the CI log names the cause.
 */
test('the app renders in Firefox: login page, sign in, home and invoice form', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.name}: ${err.message}\n${err.stack ?? ''}`));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('requestfailed', req => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`));

  try {
    await page.goto('/');
    await expect(page.getByPlaceholder('نام کاربری')).toBeVisible();
    await page.getByPlaceholder('نام کاربری').fill(E2E_ADMIN.username);
    await page.getByPlaceholder('رمز عبور').fill(E2E_ADMIN.password);
    await page.getByRole('button', { name: 'ورود به سامانه' }).click();
    await expect(page.getByTitle('خروج از حساب در همین دستگاه')).toBeVisible();

    await page.goto('/invoices/create');
    await expect(page.locator('button', { hasText: 'نام یا تلفن خریدار را بنویسید' })).toBeVisible();

    // a reload is served by the service worker the first visit installed
    await page.reload();
    await expect(page.locator('button', { hasText: 'نام یا تلفن خریدار را بنویسید' })).toBeVisible();
  } finally {
    for (const e of errors) console.log(`[firefox] ${e}`);
  }
  expect(errors.filter(e => e.startsWith('pageerror')), 'uncaught script errors in Firefox').toEqual([]);
});
