import { expect, request, test, type Page } from '@playwright/test';
import { adminApi, businessToday, closeDb, dataOf, signIn, uniqueSuffix, type AdminApi, type Json } from './support/flowKit';
import { FAKE_BOT_API_BASE, type SentMessage } from './support/fakeBotApi';

/**
 * v10.1.43 (messenger notifications plan part 4): the whole messenger path in the browser against a fake Bot API. The
 * system admin saves the Telegram staff bot's token in Settings, links their own account from Profile with the one-time
 * code (the spec "sends" it to the bot), gets the test message, and an approved payslip of the personnel linked to them
 * reaches the chat as its fixed sentence with the payslip page link, never an amount.
 */

const TEXT = {
  botSection: 'ربات تلگرام',
  saveBot: 'بررسی و ذخیره',
  botSaved: 'ربات تلگرام ذخیره شد',
  openProfile: 'مشاهده و تغییر نمایه شخصی',
  messengerTab: 'پیام‌رسان',
  linkSection: 'اتصال تلگرام',
  linkButton: 'اتصال به تلگرام',
  linked: 'وصل',
  testMessage: 'پیام آزمایشی',
  preferences: 'اعلان‌هایی که در پیام‌رسان هم می‌آید',
  payslipPreference: 'فیش حقوق تأییدشده',
  payslipSentence: 'فیش حقوق شما تأیید شد.',
} as const;

const APP_URL = `http://localhost:${Number(process.env.E2E_PORT || 3100)}`;
const FAKE_TOKEN = '123456789:E2E_fake_token_abcdefghijklmnopqrst';
const CHAT_ID = 7001;
const RATE = 125_000;
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const latinDigits = (text: string) => text.replace(/[۰-۹]/g, d => String(PERSIAN_DIGITS.indexOf(d)));

async function fake<T>(method: 'get' | 'post', path: string, data?: Json): Promise<T> {
  const api = await request.newContext({ baseURL: FAKE_BOT_API_BASE });
  try {
    const res = method === 'get' ? await api.get(path) : await api.post(path, { data });
    return await res.json() as T;
  } finally {
    await api.dispose();
  }
}

const sentTo = async (chatId: number): Promise<SentMessage[]> =>
  (await fake<{ sent: SentMessage[] }>('get', '/__control/sent')).sent.filter(m => m.messenger === 'telegram' && m.chatId === String(chatId));

async function openMessengerTab(page: Page): Promise<void> {
  await page.getByTitle(TEXT.openProfile).click();
  await page.getByRole('button', { name: TEXT.messengerTab, exact: true }).click();
}

/** A personnel linked to the admin with two work logs today; the payslip is issued and approved through the API. */
async function approvePayslipOfAdmin(admin: AdminApi, adminUserId: number): Promise<number> {
  const suffix = uniqueSuffix();
  const today = businessToday();
  const person = dataOf(await admin.send('post', '/api/personnel', {
    firstName: 'E2E', lastName: `Messenger ${suffix}`, fullName: `E2E Messenger ${suffix}`, personnelCode: `E2E-MS-${suffix}`,
    salaryType: 'piecework', jobTitle: 'E2E', userId: adminUserId,
  }));
  const task = dataOf(await admin.send('post', '/api/piecework/tasks', {
    code: `E2E-MT-${suffix}`, title: `E2E messenger task ${suffix}`, defaultRate: String(RATE), unit: 'عدد',
  }));
  await admin.send('post', '/api/piecework/logs', {
    items: [3, 2].map(quantity => ({ personnelId: Number(person.id), taskId: Number(task.id), date: today.iso, quantity })),
  });
  const payroll = dataOf(await admin.send('post', '/api/piecework/payrolls', {
    personnelId: Number(person.id), startDate: today.iso, endDate: today.iso,
  }));
  await admin.send('put', `/api/piecework/payrolls/${Number(payroll.id)}/status`, { status: 'approved' });
  return Number(payroll.id);
}

let admin: AdminApi;

test.beforeAll(async () => { admin = await adminApi(); });
test.afterAll(async () => {
  // leave no bot or link behind for the other specs
  await admin?.send('delete', '/api/messenger/links/telegram').catch(() => undefined);
  await admin?.send('put', '/api/messenger/bots/telegram', { token: '' }).catch(() => undefined);
  await admin?.dispose();
  await closeDb();
});

test('link Telegram from the profile, get the test message and the approved payslip notice', async ({ page }) => {
  await signIn(page);

  // 1. the system admin saves the staff bot's token; the server checks it with getMe on the fake API
  await page.goto('/settings?tab=messenger');
  const botSection = page.getByRole('region', { name: TEXT.botSection });
  await botSection.locator('input[type="password"]').fill(FAKE_TOKEN);
  await botSection.getByRole('button', { name: TEXT.saveBot }).click();
  await expect(page.getByText(TEXT.botSaved)).toBeVisible();

  // 2. the user asks for a link code in Profile and "sends" it to the bot from their chat
  await openMessengerTab(page);
  const linkSection = page.getByRole('region', { name: TEXT.linkSection });
  await linkSection.getByRole('button', { name: TEXT.linkButton }).click();
  const shown = await linkSection.locator('p[dir="ltr"]').first().innerText();
  const code = latinDigits(shown).replace(/\D/g, '');
  expect(code).toMatch(/^\d{6}$/);
  await fake('post', '/__control/updates', { messenger: 'telegram', chatId: CHAT_ID, text: code, firstName: 'E2E' });

  // the bot reads the code on its next pass and the card turns «وصل» on its own
  await expect(linkSection.getByText(TEXT.linked, { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await sentTo(CHAT_ID)).length, { timeout: 15_000 }).toBeGreaterThan(0);

  // 3. the test message reaches the chat
  const beforeTest = (await sentTo(CHAT_ID)).length;
  await linkSection.getByRole('button', { name: TEXT.testMessage }).click();
  await expect.poll(async () => (await sentTo(CHAT_ID)).length, { timeout: 15_000 }).toBeGreaterThan(beforeTest);

  // 4. the payslip choice is offered and on by default
  const preferences = page.getByRole('region', { name: TEXT.preferences });
  await expect(preferences.getByLabel(TEXT.payslipPreference)).toBeChecked();

  // 5. approving a payslip of the personnel linked to this user sends its fixed sentence and the payslip page link
  const me = await admin.get('/api/auth/me');
  const adminUserId = Number((me.user as Json).id);
  await approvePayslipOfAdmin(admin, adminUserId);
  await expect.poll(async () => (await sentTo(CHAT_ID)).some(m => m.text.includes(TEXT.payslipSentence)), { timeout: 60_000 }).toBe(true);
  const notice = (await sentTo(CHAT_ID)).find(m => m.text.includes(TEXT.payslipSentence))!;
  expect(notice.text).toContain(`${APP_URL}/my-payslips`);
  expect(latinDigits(notice.text)).not.toMatch(/125|625/);
});
