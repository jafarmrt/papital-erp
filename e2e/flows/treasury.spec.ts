import { expect, test, type Page } from '@playwright/test';
import {
  adminApi, businessToday, closeDb, dataOf, db, expectBalanced, netByAccount, signIn, uniqueSuffix, voucherRowsOf,
  type AdminApi, type Json, type VoucherRow,
} from '../support/flowKit';
import { toPersianDigits } from '../../src/utils/persianNumber';

/**
 * v10 (I-02): treasury and cheque flow. A final sales invoice is settled from the invoice list with a treasury receipt,
 * then a received cheque of the same customer runs received -> in collection -> cleared into the bank account.
 * Each step is checked down to its voucher rows and the bank's treasury balance.
 */

const TEXT = {
  settleButton: 'تسویه سریع فاکتور',
  settleSubmit: 'تایید و ثبت تسویه',
  settleToast: 'تسویه و دریافت وجه به مبلغ',
  settledBadge: 'تسویه کامل',
  newCheque: 'ثبت چک صیادی جدید',
  chequeNumber: 'مثال: 123456',
  sayad: '1234567890123456',
  bankName: 'مثال: بانک ملت',
  dueDateLabel: 'تاریخ سررسید *',
  customerPicker: 'جستجو و انتخاب مشتری...',
  pickerSearch: 'جستجو...',
  amount: '50000000',
  chequeSubmit: 'ثبت قطعی چک',
  chequeCreated: 'چک با موفقیت در سامانه ثبت شد',
  chequeSearch: 'جستجو در شماره چک، شناسه صیاد ۱۶ رقمی، طرف حساب یا بانک...',
  statusReceived: 'دریافت شده',
  statusInCollection: 'در جریان وصول (خوابانده به حساب)',
  statusPassed: 'وصول شده (پاس شده)',
  statusSubmit: 'ثبت وضعیت و صدور سند',
  statusUpdated: 'وضعیت چک به‌روزرسانی شد',
  issuingBank: 'بانک ملت',
} as const;

// Default account mapping codes (src/lib/accounting/accountMappingConcepts.ts) and the rial bank ledger account.
const CODE = { bankLedger: '1003', receivables: '1201', chequeInHand: '1101', chequeInCollection: '1102' } as const;

const INVOICE_QTY = 3;
const INVOICE_PRICE = 900_000;
const CHEQUE_AMOUNT = 1_250_000;

interface Setup { customerId: number; customerName: string; invoiceId: number; bankId: number; bankTitle: string }

let kit: AdminApi;
let setup: Setup;

async function prepare(api: AdminApi): Promise<Setup> {
  const suffix = uniqueSuffix();
  const today = businessToday();
  const customerName = `مشتری خزانه آزمون ${suffix}`;
  const customer = dataOf(await api.send('post', '/api/customers', {
    name: customerName, phone: `0913${String(Date.now()).slice(-7)}`, type: 'customer',
  }));
  const item = dataOf(await api.send('post', '/api/items', {
    type: 'product', name: `گوشواره خزانه ${suffix}`, code: `TR-${suffix}`, unit: 'عدد', category: 'انگشتر',
  }));
  await api.send('post', '/api/documents', {
    docType: 'receipt', inOut: 'in', status: 'final', refNumber: `TR-REC-${suffix}`, date: today.jalali,
    buyerName: 'تأمین‌کننده خزانه آزمون', items: [{ itemId: item.id, quantity: 10, unit_price: 400_000 }],
  });
  const invoice = dataOf(await api.send('post', '/api/documents', {
    docType: 'invoice', inOut: 'out', status: 'final', refNumber: 'auto', date: today.jalali, partyId: customer.id, buyerName: customerName,
    items: [{ itemId: item.id, quantity: INVOICE_QTY, unit_price: INVOICE_PRICE }],
  }));
  const [ledger] = await db<{ id: number }>(
    `SELECT a.id FROM accounts a JOIN accounts p ON p.id = a.parent_id
      WHERE a.code = $1 AND p.code = '10' AND a.is_deleted = 0`, [CODE.bankLedger]);
  expect(ledger, 'rial bank ledger account under general 10').toBeTruthy();
  const bankTitle = `بانک خزانه آزمون ${suffix}`;
  const bank = dataOf(await api.send('post', '/api/accounting/bank-accounts', {
    title: bankTitle, type: 'bank', bankName: 'بانک آزمون', currency: 'IRR', initialBalance: '0', accountId: ledger.id,
  }));
  return {
    customerId: Number(customer.id), customerName, invoiceId: Number(invoice.docId),
    bankId: Number(bank.id), bankTitle,
  };
}

function rowOf(rows: VoucherRow[], code: string, side: 'debit' | 'credit'): VoucherRow | undefined {
  return rows.find(r => r.code === code && Number(r[side]) > 0);
}

async function bankBalances(): Promise<Json> {
  const list = dataOf<Json[]>(await kit.get('/api/accounting/bank-accounts'));
  const bank = (Array.isArray(list) ? list : []).find(b => Number(b.id) === setup.bankId);
  expect(bank, 'bank account listed').toBeTruthy();
  return bank as Json;
}

async function changeChequeStatus(page: Page, chequeNumber: string, current: string, next: string, nextLabel: string): Promise<void> {
  const row = page.locator('tr', { hasText: chequeNumber });
  await row.getByRole('button', { name: current, exact: true }).click();
  const form = page.locator('form', { has: page.getByRole('button', { name: TEXT.statusSubmit }) });
  await form.locator('select').first().selectOption(next);
  await form.locator('select', { has: page.locator(`option[value="${setup.bankId}"]`) }).selectOption(String(setup.bankId));
  const sent = page.waitForResponse(r => /\/api\/accounting\/cheques\/\d+\/status$/.test(r.url()) && r.request().method() === 'PATCH');
  await form.getByRole('button', { name: TEXT.statusSubmit }).click();
  expect((await sent).status(), `cheque status ${next}`).toBe(200);
  await expect(page.getByText(TEXT.statusUpdated).first()).toBeVisible();
  await expect(row.getByRole('button', { name: nextLabel, exact: true }), `cheque row shows ${next}`).toBeVisible();
}

test.beforeAll(async () => {
  kit = await adminApi();
  setup = await prepare(kit);
});

test.afterAll(async () => {
  await kit?.dispose();
  await closeDb();
});

test('settle a sales invoice with a treasury receipt and post its voucher', async ({ page }) => {
  const before = dataOf(await kit.get(`/api/documents/${setup.invoiceId}`));
  const payable = Number(before.payableAmount);
  expect(payable, 'invoice payable amount').toBeGreaterThan(0);

  await signIn(page);
  await page.goto(`/invoices?search=${encodeURIComponent(setup.customerName)}`);
  const row = page.locator('tr', { hasText: setup.customerName });
  await row.getByTitle(TEXT.settleButton).click();
  await page.locator('select', { has: page.locator(`option[value="${setup.bankId}"]`) }).selectOption(String(setup.bankId));
  const sent = page.waitForResponse(r => r.url().endsWith('/api/accounting/treasury') && r.request().method() === 'POST');
  await page.getByRole('button', { name: TEXT.settleSubmit }).click();
  expect((await sent).status(), 'treasury receipt').toBeLessThan(300);
  await expect(page.getByText(TEXT.settleToast)).toBeVisible();
  await expect(row.getByText(TEXT.settledBadge)).toBeVisible();

  const [tx] = await db<{ id: number; voucherId: number; partyType: string; partyId: number; amount: string; type: string }>(
    `SELECT id, voucher_id AS "voucherId", party_type AS "partyType", party_id AS "partyId", amount::text AS amount, type
       FROM treasury_transactions WHERE document_id = $1 AND is_deleted = 0 AND reversal_of_id IS NULL`, [setup.invoiceId]);
  expect(tx, 'treasury row linked to the invoice').toBeTruthy();
  expect(tx.type, 'treasury row type').toBe('receipt');
  expect(tx.partyType, 'treasury row party type').toBe('customer');
  expect(Number(tx.partyId), 'treasury row party id').toBe(setup.customerId);
  expect(Number(tx.amount), 'treasury row amount').toBe(payable);

  const after = dataOf(await kit.get(`/api/documents/${setup.invoiceId}`));
  expect(Number(after.paidAmount), 'invoice paid amount').toBe(payable);
  expect(Number(after.remainingAmount), 'invoice remaining amount').toBe(0);
  expect(after.settlementStatus, 'invoice settlement status').toBe('fully_paid');

  const rows = await voucherRowsOf('id', tx.voucherId);
  expectBalanced(rows);
  expect(netByAccount(rows), 'receipt voucher nets').toEqual({ [CODE.bankLedger]: payable, [CODE.receivables]: -payable });
  const bankRow = rowOf(rows, CODE.bankLedger, 'debit');
  expect([bankRow?.detailedType, Number(bankRow?.detailedId)], 'bank row detail').toEqual(['bank_account', setup.bankId]);
  const partyRow = rowOf(rows, CODE.receivables, 'credit');
  expect([partyRow?.detailedType, Number(partyRow?.detailedId)], 'customer row detail').toEqual(['customer', setup.customerId]);

  const bank = await bankBalances();
  expect(Number(bank.treasuryBalance), 'bank treasury balance after receipt').toBe(payable);
});

test('run a received cheque to cleared and post each step', async ({ page }) => {
  const { iso, jalali } = businessToday();
  const chequeNumber = String(Date.now()).slice(-8);
  const sayad = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-16).padStart(16, '7');
  const balanceBefore = Number((await bankBalances()).treasuryBalance);

  await signIn(page);
  await page.goto('/accounting/cheques');
  await page.getByRole('button', { name: TEXT.newCheque }).click();
  await page.getByPlaceholder(TEXT.chequeNumber).fill(chequeNumber);
  await page.getByPlaceholder(TEXT.sayad).fill(sayad);
  await page.getByPlaceholder(TEXT.bankName).fill(TEXT.issuingBank);
  const dueInput = page.getByText(TEXT.dueDateLabel, { exact: true }).locator('xpath=..').locator('input');
  // Due today: pick the highlighted day of the Jalali calendar.
  await dueInput.click();
  await page.locator('.rmdp-day-picker .rmdp-day.rmdp-today').click();
  await expect(dueInput, 'due date picked').toHaveValue(toPersianDigits(jalali));
  await page.getByPlaceholder(TEXT.bankName).click();
  await page.getByRole('button', { name: TEXT.customerPicker }).click();
  await page.getByPlaceholder(TEXT.pickerSearch).fill(setup.customerName);
  await page.locator('li', { hasText: setup.customerName }).first().click();
  await page.getByPlaceholder(TEXT.amount).fill(String(CHEQUE_AMOUNT));
  const created = page.waitForResponse(r => r.url().endsWith('/api/accounting/cheques') && r.request().method() === 'POST');
  await page.getByRole('button', { name: TEXT.chequeSubmit }).click();
  expect((await created).status(), 'cheque registration').toBeLessThan(300);
  await expect(page.getByText(TEXT.chequeCreated)).toBeVisible();

  const [cheque] = await db<{ id: number; status: string; partyId: number; amount: string; dueDate: string; sayad: string }>(
    `SELECT id, status, party_id AS "partyId", amount::text AS amount, due_date AS "dueDate", sayad_number AS sayad
       FROM cheques WHERE cheque_number = $1 AND is_deleted = 0`, [chequeNumber]);
  expect(cheque, 'cheque row').toBeTruthy();
  expect([cheque.status, Number(cheque.partyId), Number(cheque.amount), cheque.dueDate, cheque.sayad], 'cheque fields')
    .toEqual(['received', setup.customerId, CHEQUE_AMOUNT, iso, sayad]);

  const registration = await voucherRowsOf('source_cheque_id', cheque.id);
  expectBalanced(registration);
  expect(netByAccount(registration), 'registration voucher nets')
    .toEqual({ [CODE.chequeInHand]: CHEQUE_AMOUNT, [CODE.receivables]: -CHEQUE_AMOUNT });
  const partyRow = rowOf(registration, CODE.receivables, 'credit');
  expect([partyRow?.detailedType, Number(partyRow?.detailedId)], 'cheque customer row detail').toEqual(['customer', setup.customerId]);

  await page.getByPlaceholder(TEXT.chequeSearch).fill(chequeNumber);
  await changeChequeStatus(page, chequeNumber, TEXT.statusReceived, 'in_collection', TEXT.statusInCollection);
  const collection = (await voucherRowsOf('source_cheque_id', cheque.id)).filter(r => !registration.some(x => x.voucherId === r.voucherId));
  expectBalanced(collection);
  expect(netByAccount(collection), 'in-collection voucher nets')
    .toEqual({ [CODE.chequeInCollection]: CHEQUE_AMOUNT, [CODE.chequeInHand]: -CHEQUE_AMOUNT });

  await changeChequeStatus(page, chequeNumber, TEXT.statusInCollection, 'passed', TEXT.statusPassed);
  const all = await voucherRowsOf('source_cheque_id', cheque.id);
  const known = new Set([...registration, ...collection].map(r => r.voucherId));
  const clearing = all.filter(r => !known.has(r.voucherId));
  expectBalanced(clearing);
  expect(netByAccount(clearing), 'clearing voucher nets')
    .toEqual({ [CODE.bankLedger]: CHEQUE_AMOUNT, [CODE.chequeInCollection]: -CHEQUE_AMOUNT });
  const bankRow = rowOf(clearing, CODE.bankLedger, 'debit');
  expect([bankRow?.detailedType, Number(bankRow?.detailedId)], 'clearing bank row detail').toEqual(['bank_account', setup.bankId]);
  expect(netByAccount(all), 'whole cheque lifecycle nets')
    .toEqual({ [CODE.bankLedger]: CHEQUE_AMOUNT, [CODE.receivables]: -CHEQUE_AMOUNT, [CODE.chequeInHand]: 0, [CODE.chequeInCollection]: 0 });

  const [stored] = await db<{ status: string; bankAccountId: number }>(
    'SELECT status, bank_account_id AS "bankAccountId" FROM cheques WHERE id = $1', [cheque.id]);
  expect([stored.status, Number(stored.bankAccountId)], 'cleared cheque keeps its bank').toEqual(['passed', setup.bankId]);
  const bank = await bankBalances();
  expect(Number(bank.treasuryBalance), 'bank treasury balance includes the cleared cheque').toBe(balanceBefore + CHEQUE_AMOUNT);
  expect(Number(bank.currentBalance), 'bank current balance').toBe(balanceBefore + CHEQUE_AMOUNT);
});
