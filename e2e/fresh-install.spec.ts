import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';
import { DEFAULT_CATEGORIES } from '../src/data/defaultCategories';
import { withRequiredPermissions } from '../src/lib/permissions/permissionCatalog';
import { ROLE_TEMPLATES } from '../src/lib/permissions/roleTemplates';

/**
 * v9.0.134 (TD-526، یافته B02-11، مدل مجوز §۴.۶ بند ۵): نصب تازه تولیدی بی هیچ متغیر seed — فقط نقش «مدیر سیستم» هست،
 * داده پایه (دسته‌ها) در بوت ساخته شده است و نقشی که مدیر با «ساخت نقش از الگو» می‌سازد دقیقاً تیک‌های همان الگو را دارد.
 * کار روزمره مدیر روی همین نصب را مسیر حیاتی (`critical-path.spec.ts`) می‌آزماید.
 */
const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT || 3100)}`;
const template = ROLE_TEMPLATES.find(t => t.code === 'treasurer')!;
let createdRoleId: number | null = null;

async function adminApi(): Promise<{ api: APIRequestContext; csrf: string }> {
  const api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/login', { data: E2E_ADMIN });
  expect(login.ok()).toBe(true);
  return { api, csrf: String((await login.json()).csrfToken) };
}

test.afterAll(async () => {
  if (createdRoleId === null) return;
  const { api, csrf } = await adminApi();
  await api.delete(`/api/roles/${createdRoleId}`, { headers: { 'x-csrf-token': csrf } });
  await api.dispose();
});

test('a fresh install has only the system admin role, and a role made from a template has exactly its permissions', async ({ page }) => {
  const { api } = await adminApi();
  const roles = await (await api.get('/api/roles')).json() as Array<{ code: string }>;
  expect(roles.map(r => r.code)).toEqual(['admin']);
  const categories = await (await api.get('/api/categories')).json() as Array<{ name: string }>;
  expect(categories.map(c => c.name).sort()).toEqual(DEFAULT_CATEGORIES.map(c => c.name).sort());

  await page.goto('/');
  await page.getByPlaceholder('نام کاربری').fill(E2E_ADMIN.username);
  await page.getByPlaceholder('کلمه عبور').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'ورود به سیستم' }).click();
  await expect(page.getByText('خروج از حساب')).toBeVisible();

  await page.goto('/users');
  await page.getByRole('button', { name: /ماتریس نقش‌ها و مجوزها/ }).click();
  await page.getByRole('button', { name: 'ساخت نقش از الگو' }).click();
  await page.getByRole('button', { name: new RegExp(template.name) }).click();
  await expect(page.getByPlaceholder('e.g. warehouse_assistant')).toHaveValue(template.code);

  const saved = page.waitForResponse(r => r.url().endsWith('/api/roles') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'ذخیره نقش و مجوزها' }).click();
  const response = await saved;
  expect(response.status()).toBe(200);

  const after = await (await api.get('/api/roles')).json() as Array<{ id: number; code: string; permissions: string[] }>;
  const created = after.find(r => r.code === template.code);
  expect(created, 'the role made from the template is listed').toBeTruthy();
  createdRoleId = created!.id;
  expect([...created!.permissions].sort()).toEqual([...withRequiredPermissions(template.permissions)].sort());
  await api.dispose();
});
