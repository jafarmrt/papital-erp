import { expect, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/**
 * v7.0.77 (audit P3-7): مسیر حیاتی — ورود، صدور فاکتور فروش نهایی، دیدن سند حسابداری دوبل همان فاکتور.
 */
test('login, issue a final sales invoice and see its journal voucher', async ({ page }) => {
  const itemCode = process.env.E2E_ITEM_CODE ?? '';
  const customerName = process.env.E2E_CUSTOMER_NAME ?? '';
  expect(itemCode, 'global setup must create the item').not.toBe('');

  // ۱. ورود
  await page.goto('/');
  await page.getByPlaceholder('نام کاربری').fill(E2E_ADMIN.username);
  await page.getByPlaceholder('کلمه عبور').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'ورود به سیستم' }).click();
  await expect(page.getByText('خروج از حساب')).toBeVisible();

  // ۲. صدور فاکتور فروش نهایی: ۲ عدد × ۷۵۰٬۰۰۰ ریال
  await page.goto('/invoices/create');
  await page.getByRole('button', { name: /جهت انتخاب خریدار/ }).click();
  await page.keyboard.type(customerName);
  await page.locator('li', { hasText: customerName }).first().click();
  await page.getByRole('button', { name: 'انتخاب کالا / ماده اولیه' }).click();
  await page.keyboard.type(itemCode);
  await page.locator('li', { hasText: itemCode }).first().click();
  const numbers = page.locator('input[type=number]');
  await numbers.nth(0).fill('2');
  await numbers.nth(1).fill('750000');
  await page.getByRole('button', { name: 'افزودن به فهرست' }).click();

  const created = page.waitForResponse(r => r.url().endsWith('/api/documents') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'ثبت و صدور فاکتور' }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  await expect(page.getByText('فاکتور و سند حسابداری دوبل آن با موفقیت ثبت شدند')).toBeVisible();
  await expect(page.getByText('صورتحساب فروش کالا و خدمات')).toBeVisible();

  // ۳. سند حسابداری همان فاکتور در فهرست اسناد دوبل
  await page.goto('/accounting/vouchers');
  await expect(page.getByText(new RegExp(`ثبت فاکتور فروش شماره .* به نام ${customerName}`)).first()).toBeVisible();
});
