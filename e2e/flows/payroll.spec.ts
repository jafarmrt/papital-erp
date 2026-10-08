import { expect, test, type Locator } from '@playwright/test';
import {
  adminApi, businessToday, closeDb, dataOf, db, expectBalanced, netByAccount, signIn, uniqueSuffix, voucherRowsOf,
  type AdminApi, type Json,
} from '../support/flowKit';

/**
 * v10 (I-02): payslip and payment flow. The API prepares a personnel, a piecework task, two work logs and a rial bank
 * account; the browser issues the payslip, approves it and pays it from the bank; the database is checked down to the
 * payslip and payment voucher rows (AGENTS §11 Payroll Status, Piecework Rates and Work Logs).
 */

const TEXT = {
  payrollsTab: 'فیش‌های حقوقی و تسویه‌ها',
  newPayroll: 'صدور فیش حقوقی جدید',
  pickPersonnel: 'جستجو و انتخاب پرسنل...',
  startDate: 'انتخاب تاریخ شروع',
  endDate: 'انتخاب تاریخ پایان',
  issue: 'تایید و صدور فیش حقوقی',
  approve: 'تأیید فیش',
  registerPayment: 'ثبت پرداخت',
  fullSettlement: 'ثبت تسویه کامل',
  confirmPayment: 'بله، ثبت پرداخت',
  paid: 'پرداخت‌شده',
  logRows: 'ردیف',
  modalTitle: 'صدور فیش حقوقی کارکرد پرسنل',
} as const;

// Account mapping defaults (src/lib/accounting/accountMappingConcepts.ts) and the bank's ledger account under 10.
const ACCOUNTS = { directWages: '6002', wagesPayable: '3201', rialBanks: '1003' } as const;

const DAY_ONE = '۱';
const RATE = 125_000;
const QUANTITIES = [3, 2] as const;
const NET = RATE * QUANTITIES.reduce((s, q) => s + q, 0);
const BANK_OPENING = 10_000_000;

/** A random 10-digit Iranian national id with a correct check digit (validateIranianNationalId). */
function nationalId(): string {
  for (;;) {
    const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    const sum = digits.reduce((s, d, i) => s + d * (10 - i), 0);
    const r = sum % 11;
    const id = `${digits.join('')}${r < 2 ? r : 11 - r}`;
    if (!/^(\d)\1{9}$/.test(id)) return id;
  }
}

/** True when a click at the element's centre reaches the element (no other layer covers it). */
async function isOnTop(locator: Locator): Promise<boolean> {
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && el.contains(hit);
  });
}

interface Setup {
  personnelId: number;
  personnelName: string;
  bankId: number;
  bankTitle: string;
  logIds: number[];
}

async function prepare(admin: AdminApi): Promise<Setup> {
  const suffix = uniqueSuffix();
  const today = businessToday();
  const personnelName = `E2E Payroll ${suffix}`;
  const person = dataOf(await admin.send('post', '/api/personnel', {
    firstName: 'E2E', lastName: `Payroll ${suffix}`, fullName: personnelName, personnelCode: `E2E-PR-${suffix}`,
    nationalId: nationalId(), salaryType: 'piecework', jobTitle: 'E2E',
  }));
  const task = dataOf(await admin.send('post', '/api/piecework/tasks', {
    code: `E2E-T-${suffix}`, title: `E2E task ${suffix}`, defaultRate: String(RATE), unit: 'عدد',
  }));
  const logs = await admin.send('post', '/api/piecework/logs', {
    items: QUANTITIES.map(quantity => ({ personnelId: Number(person.id), taskId: Number(task.id), date: today.iso, quantity })),
  });
  const ledger = await db<{ id: number }>(`SELECT id FROM accounts WHERE code = $1 AND is_deleted = 0`, [ACCOUNTS.rialBanks]);
  const bankTitle = `E2E Payroll Bank ${suffix}`;
  const bank = dataOf(await admin.send('post', '/api/accounting/bank-accounts', {
    title: bankTitle, type: 'bank', bankName: 'E2E', currency: 'IRR', initialBalance: String(BANK_OPENING), accountId: ledger[0].id,
  }));
  return {
    personnelId: Number(person.id), personnelName, bankId: Number(bank.id), bankTitle,
    logIds: (logs.insertedIds as number[]).map(Number),
  };
}

interface PayrollRow extends Json {
  id: number;
  status: string;
  net: string;
  piecework: string;
  paid: string;
}

async function payrollOf(personnelId: number): Promise<PayrollRow[]> {
  return db<PayrollRow>(
    `SELECT id, status, net_payable::text AS net, total_piecework_amount::text AS piecework, paid_amount::text AS paid
       FROM piecework_payrolls WHERE personnel_id = $1 AND is_deleted = 0`, [personnelId]);
}

let admin: AdminApi;

test.beforeAll(async () => { admin = await adminApi(); });
test.afterAll(async () => {
  await admin?.dispose();
  await closeDb();
});

test('issue a payslip from work logs, approve it and pay it from a bank account', async ({ page }) => {
  const setup = await prepare(admin);
  const today = businessToday();

  // 1. Issue the payslip for the current Jalali month up to today.
  await signIn(page);
  await page.goto('/piecework');
  await page.getByRole('button', { name: TEXT.payrollsTab }).click();
  await page.getByRole('button', { name: TEXT.newPayroll }).click();
  await page.getByRole('button', { name: TEXT.pickPersonnel }).click();
  await page.keyboard.type(setup.personnelName);
  await page.locator('li', { hasText: setup.personnelName }).first().click();
  // The Jalali pickers open on the current month: day 1, then today.
  await page.getByPlaceholder(TEXT.startDate).click();
  await page.locator('.rmdp-day-picker .rmdp-day:not(.rmdp-day-hidden):visible').getByText(DAY_ONE, { exact: true }).click();
  await page.getByPlaceholder(TEXT.endDate).click();
  await page.locator('.rmdp-day-picker .rmdp-day.rmdp-today:visible').click();
  await page.getByText(TEXT.modalTitle).click();
  const previewCount = new Intl.NumberFormat('fa-IR').format(QUANTITIES.length);
  await expect(page.getByText(`${previewCount} ${TEXT.logRows}`), 'preview lists the free work logs').toBeVisible();

  const issued = page.waitForResponse(r => /\/api\/piecework\/payrolls$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: TEXT.issue }).click();
  expect((await issued).status(), 'payslip issue status').toBe(201);

  const [payroll] = await payrollOf(setup.personnelId);
  expect(payroll, 'one live payslip of the personnel').toBeTruthy();
  expect(Number(payroll.piecework), 'piecework amount = sum of work logs').toBe(NET);
  expect(Number(payroll.net), 'net payable = sum of work logs').toBe(NET);

  // Payslip voucher: Dr direct wages / Cr wages payable with exactly the net, on the personnel detail.
  const payslipRows = await voucherRowsOf('source_payroll_id', payroll.id);
  expectBalanced(payslipRows);
  expect(new Set(payslipRows.map(r => r.voucherId)).size, 'one payslip voucher').toBe(1);
  expect(netByAccount(payslipRows), 'payslip voucher accounts').toEqual({ [ACCOUNTS.directWages]: NET, [ACCOUNTS.wagesPayable]: -NET });
  const payableRow = payslipRows.find(r => r.code === ACCOUNTS.wagesPayable);
  expect(payableRow?.detailedType, 'wages payable detail type').toBe('personnel');
  expect(Number(payableRow?.detailedId), 'wages payable detail id').toBe(setup.personnelId);

  const linked = await db<{ n: string }>(
    `SELECT count(*)::text AS n FROM piecework_logs WHERE payroll_id = $1 AND is_deleted = 0`, [payroll.id]);
  expect(Number(linked[0].n), 'work logs linked to the payslip').toBe(QUANTITIES.length);

  // 2. The issue answers «approved»; put it back to draft so the browser's «تأیید فیش» step is exercised.
  expect(payroll.status, 'issued payslip status').toBe('approved');
  await admin.send('put', `/api/piecework/payrolls/${payroll.id}/status`, { status: 'draft' });
  await page.reload();
  await page.getByRole('button', { name: TEXT.payrollsTab }).click();
  const row = page.locator('tr', { hasText: setup.personnelName });
  const approved = page.waitForResponse(r => r.url().endsWith(`/api/piecework/payrolls/${payroll.id}/status`) && r.request().method() === 'PUT');
  await row.getByRole('button', { name: TEXT.approve }).click();
  expect((await approved).status(), 'approve status').toBe(200);
  expect((await payrollOf(setup.personnelId))[0].status, 'payslip approved').toBe('approved');
  expect(new Set((await voucherRowsOf('source_payroll_id', payroll.id)).map(r => r.voucherId)).size, 'approve keeps one payslip voucher').toBe(1);

  // 3. Pay the whole net from the bank account.
  await row.getByRole('button', { name: TEXT.registerPayment }).click();
  await page.locator('select').filter({ hasText: setup.bankTitle }).selectOption({ label: `${setup.bankTitle} (E2E)` });
  await page.getByRole('button', { name: TEXT.fullSettlement }).click();
  const paidRes = page.waitForResponse(r => r.url().endsWith(`/api/piecework/payrolls/${payroll.id}/register-payment`));
  const confirm = page.getByRole('button', { name: TEXT.confirmPayment });
  await expect.poll(() => isOnTop(confirm), { message: 'payment confirmation is above the payment window', timeout: 5_000 }).toBe(true);
  await confirm.click();
  expect((await paidRes).status(), 'payment status').toBe(200);
  await expect(row.getByRole('button', { name: TEXT.paid }), 'row shows paid').toBeVisible();

  const [after] = await payrollOf(setup.personnelId);
  expect(after.status, 'payslip paid').toBe('paid');
  expect(Number(after.paid), 'paid amount = net').toBe(NET);

  const tx = await db<{ id: number; voucherId: number; amount: string; date: string; partyId: number; type: string; status: string }>(
    `SELECT id, voucher_id AS "voucherId", amount::text AS amount, date, party_id AS "partyId", type, status
       FROM treasury_transactions WHERE payroll_id = $1 AND is_deleted = 0`, [payroll.id]);
  expect(tx.length, 'one treasury row').toBe(1);
  expect(tx[0].type, 'treasury row type').toBe('payment');
  expect(tx[0].status, 'treasury row status').toBe('completed');
  expect(Number(tx[0].amount), 'treasury amount').toBe(NET);
  expect(Number(tx[0].partyId), 'treasury party').toBe(setup.personnelId);
  expect(tx[0].date, 'payment date is business today').toBe(today.iso);

  // Payment voucher: Dr wages payable (personnel) / Cr the bank's ledger account (bank detail).
  const payRows = await db<{ code: string; debit: string; credit: string; detailedType: string; detailedId: number }>(
    `SELECT a.code, i.debit::text AS debit, i.credit::text AS credit, i.detailed_type AS "detailedType", i.detailed_id AS "detailedId"
       FROM journal_voucher_items i JOIN accounts a ON a.id = i.account_id JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE i.voucher_id = $1 AND i.is_deleted = 0 AND v.is_deleted = 0 ORDER BY i.id`, [tx[0].voucherId]);
  expect(payRows.map(r => [r.code, Number(r.debit), Number(r.credit), r.detailedType, Number(r.detailedId)]), 'payment voucher rows').toEqual([
    [ACCOUNTS.wagesPayable, NET, 0, 'personnel', setup.personnelId],
    [ACCOUNTS.rialBanks, 0, NET, 'bank_account', setup.bankId],
  ]);

  const bank = await db<{ balance: string }>(`SELECT current_balance::text AS balance FROM bank_accounts WHERE id = $1`, [setup.bankId]);
  expect(Number(bank[0].balance), 'bank balance after payment').toBe(BANK_OPENING - NET);

  const logs = await db<{ status: string }>(`SELECT status FROM piecework_logs WHERE id = ANY($1::int[])`, [setup.logIds]);
  expect(logs.map(l => l.status), 'work logs paid').toEqual(QUANTITIES.map(() => 'paid'));
});
