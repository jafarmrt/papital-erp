import { request, type APIRequestContext } from '@playwright/test';

/**
 * v7.0.77 (audit P3-7): داده پایه مسیر حیاتی از API — مدیر سیستم (راه‌اندازی اولیه)، یک کالا با رسید خرید
 * (موجودی و بهای میانگین) و یک مشتری. کد کالا و نام مشتری در هر اجرا یکتا هستند تا اجرای دوباره روی همان
 * پایگاه‌داده محلی هم کار کند. مقادیر از طریق process.env به تست می‌رسند.
 */
const PORT = Number(process.env.E2E_PORT || 3100);
const BASE_URL = `http://localhost:${PORT}`;
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN || 'e2e_setup_token_at_least_16_chars';
export const E2E_ADMIN = { username: 'pwadmin', password: 'Pw-Admin-Pass-2026' };

async function ensureOk(label: string, res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`${label}: HTTP ${res.status()} ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: BASE_URL });
  try {
    const status = await (await api.get('/api/check-setup')).json() as { isSetup?: boolean };
    if (!status.isSetup) {
      await ensureOk('setup', await api.post('/api/setup', {
        headers: { 'x-setup-token': SETUP_TOKEN },
        data: { ...E2E_ADMIN, fullName: 'مدیر آزمون سرتاسری', companyName: 'کارگاه آزمون سرتاسری' },
      }));
    }
    const login = await ensureOk('login', await api.post('/api/login', { data: E2E_ADMIN }));
    const headers = { 'x-csrf-token': String(login.csrfToken) };

    const suffix = Date.now().toString(36).toUpperCase();
    const itemCode = `PW-${suffix}`;
    const customerName = `مشتری آزمون سرتاسری ${suffix}`;
    const item = await ensureOk('item', await api.post('/api/items', {
      headers,
      data: { type: 'product', name: `گردنبند آزمون ${suffix}`, code: itemCode, unit: 'عدد', category: 'گردنبند' },
    }));
    await ensureOk('receipt', await api.post('/api/documents', {
      headers,
      data: {
        docType: 'receipt', inOut: 'in', status: 'final', refNumber: `PW-REC-${suffix}`, date: '1405/07/10',
        buyerName: 'تأمین‌کننده آزمون سرتاسری', items: [{ itemId: item.id, quantity: 20, unit_price: 400000 }],
      },
    }));
    await ensureOk('customer', await api.post('/api/customers', {
      headers,
      data: { name: customerName, phone: `0912${String(Date.now()).slice(-7)}`, type: 'customer' },
    }));

    process.env.E2E_ITEM_CODE = itemCode;
    process.env.E2E_CUSTOMER_NAME = customerName;
  } finally {
    await api.dispose();
  }
}
