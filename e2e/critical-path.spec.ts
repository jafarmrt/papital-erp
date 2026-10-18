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
  await page.getByRole('button', { name: 'ورود به سامانه' }).click();
  await expect(page.getByTitle('خروج از حساب در همین دستگاه')).toBeVisible();

  // ۲. صدور فاکتور فروش نهایی: ۲ عدد × ۷۵۰٬۰۰۰ ریال
  await page.goto('/invoices/create');
  // v10.0.192 (TD-1260): type into the picker's own search box; keyboard.type right after the click could send the
  // first key before the box mounted and searched a broken name
  // v10.1.31 (TD-1278): a picker is named by its label; its placeholder is only the shown text
  // v10.2.4 (TD-1292): the invoice form's pickers show shorter placeholders
  await page.locator('button', { hasText: 'نام یا تلفن خریدار را بنویسید' }).click();
  await page.getByPlaceholder('جست‌وجو...', { exact: true }).fill(customerName);
  await page.locator('li', { hasText: customerName }).first().click();
  await page.locator('button', { hasText: 'کد یا نام کالا را بنویسید' }).click();
  await page.getByPlaceholder('جست‌وجو...', { exact: true }).fill(itemCode);
  await page.locator('li', { hasText: itemCode }).first().click();
  // v10.1.22 (TD-1273): number fields are text fields with the decimal keypad, found by their label
  await page.getByLabel('تعداد', { exact: true }).fill('2');
  await page.getByLabel(/^مبلغ واحد/).fill('750000');
  await page.getByRole('button', { name: 'افزودن به فهرست' }).click();

  const created = page.waitForResponse(r => r.url().endsWith('/api/documents') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'ثبت و صدور فاکتور' }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  await expect(page.getByText('فاکتور و سند حسابداری آن با موفقیت ثبت شدند')).toBeVisible();
  await expect(page.getByText('صورتحساب فروش کالا و خدمات')).toBeVisible();

  // ۳. سند حسابداری همان فاکتور در فهرست اسناد دوبل
  await page.goto('/accounting/vouchers');
  await expect(page.getByText(new RegExp(`ثبت فاکتور فروش شماره .* به نام ${customerName}`)).first()).toBeVisible();
});
