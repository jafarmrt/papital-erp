import { expect, test, type Page } from '@playwright/test';
import {
  adminApi, businessToday, closeDb, dataOf, db, expectBalanced, netByAccount, signIn, uniqueSuffix, voucherRowsOf,
  type AdminApi, type Json,
} from '../support/flowKit';

/**
 * v10 (I-02): project production and delivery. The API prepares a raw material with stock and a weighted average
 * cost, a product and a project planning that product; the browser allocates the material to the project and
 * delivers the finished goods; the database is checked down to the voucher rows.
 */
const ALLOCATION_TEXT = {
  tab: 'تخصیص مواد به پروژه‌ها',
  open: 'تخصیص مواد به پروژه',
  projectLabel: 'پروژه تولید مقصد',
  search: 'جستجو...',
  submit: 'تأیید و ثبت تخصیص',
  inProgress: 'در جریان تولید',
} as const;

const DELIVERY_TEXT = {
  projectSearch: 'جستجو (کد پروژه، مشتری، کالا)...',
  tab: '۶. ورود به انبار',
  deliver: 'ورود به انبار',
  overTitle: 'تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه',
  overReason: 'مثال: مشتری ۲ عدد اضافه سفارش داد',
  cancel: 'انصراف',
  delivered: 'به انبار تحویل داده شد',
} as const;

// Default codes of the account mapping (src/lib/accounting/accountMappingConcepts.ts)
const ACCOUNTS = { rawMaterials: '1401', workInProgress: '1402', finishedGoods: '1403' } as const;

const RECEIPT_QTY = 10;
const RAW_UNIT_COST = 50_000;
const ALLOCATE_QTY = 4;
const PLANNED_QTY = 5;
const PRODUCT_UNIT_COST = 40_000;

interface Setup { raw: Json; product: Json; project: Json }

let admin: AdminApi;
let setup: Setup;

async function prepare(): Promise<void> {
  const suffix = uniqueSuffix();
  const today = businessToday().iso;
  const raw = await admin.send('post', '/api/items', {
    type: 'raw_material', name: `مهره آزمون تولید ${suffix}`, code: `PWR-${suffix}`, unit: 'عدد', category: 'مهره',
  });
  await admin.send('post', '/api/documents', {
    docType: 'receipt', inOut: 'in', status: 'final', refNumber: `PWR-REC-${suffix}`, date: today,
    buyerName: 'تأمین‌کننده آزمون تولید', items: [{ itemId: raw.id, quantity: RECEIPT_QTY, unit_price: RAW_UNIT_COST }],
  });
  const product = await admin.send('post', '/api/items', {
    type: 'product', name: `گردنبند آزمون تولید ${suffix}`, code: `PWP-${suffix}`, unit: 'عدد', category: 'گردنبند',
  });
  const project = await admin.send('post', '/api/projects', {
    title: `پروژه آزمون تولید ${suffix}`, start_date: today, end_date: today, quantity: PLANNED_QTY, unit: 'عدد',
    products: [{
      id: `prod-${suffix}`, item_id: product.id, item_code: product.code, item_name: product.name,
      customer_code: '', quantity: PLANNED_QTY, unit: 'عدد', needs_assembly: true,
    }],
  });
  setup = { raw: dataOf(raw), product: dataOf(product), project: dataOf(project) };
}

test.beforeAll(async () => {
  admin = await adminApi();
  await prepare();
});

test.afterAll(async () => {
  await admin?.dispose();
  await closeDb();
});

const projectCodeOf = (): string => String(setup.project.project_code ?? setup.project.projectCode);

async function allocateInBrowser(page: Page): Promise<Json> {
  await page.goto('/audit');
  await page.getByRole('button', { name: ALLOCATION_TEXT.tab }).click();
  await page.getByRole('button', { name: ALLOCATION_TEXT.open, exact: true }).click();
  const form = page.locator('form').filter({ hasText: ALLOCATION_TEXT.projectLabel });
  const pick = async (index: number, text: string): Promise<void> => {
    await form.getByRole('button').nth(index).click();
    await page.getByPlaceholder(ALLOCATION_TEXT.search).fill(text);
    await page.locator('li', { hasText: text }).first().click();
  };
  await pick(0, projectCodeOf());
  await pick(1, String(setup.raw.code));
  await form.locator('input[type=number]').fill(String(ALLOCATE_QTY));
  const posted = page.waitForResponse(r => r.url().endsWith('/api/inventory/allocations/allocate') && r.request().method() === 'POST');
  await form.getByRole('button', { name: ALLOCATION_TEXT.submit }).click();
  const response = await posted;
  expect(response.status(), 'allocation answer').toBe(200);
  const row = page.locator('tr', { hasText: String(setup.raw.code) });
  await expect(row.getByText(ALLOCATION_TEXT.inProgress)).toBeVisible();
  return (await response.json()) as Json;
}

async function openDeliveryTab(page: Page): Promise<void> {
  await page.goto('/projects');
  await page.getByPlaceholder(DELIVERY_TEXT.projectSearch).fill(projectCodeOf());
  await page.getByText(String(setup.project.title), { exact: true }).first().click();
  await page.getByRole('button', { name: DELIVERY_TEXT.tab }).click();
}

test('allocate raw material to a project and deliver its finished goods to stock', async ({ page }) => {
  const rawId = Number(setup.raw.id);
  const productId = Number(setup.product.id);
  const projectId = Number(setup.project.id);
  await signIn(page);

  // 1. Allocation: an out Kardex row at the WAC and a WIP voucher with the project's detail
  const allocated = dataOf<{ allocations: Array<{ id: number }> }>(await allocateInBrowser(page));
  const allocationId = Number(allocated.allocations?.[0]?.id);
  const [allocation] = await db(
    `SELECT a.status, a.quantity::text AS qty, t.type, t.quantity::text AS "outQty", t.total_price::text AS cost
       FROM project_bom_allocations a JOIN transactions t ON t.id = a.source_transaction_id
      WHERE a.id = $1 AND a.project_id = $2 AND a.item_id = $3 AND a.is_deleted = 0`, [allocationId, projectId, rawId]);
  expect(allocation, 'allocation row with its Kardex movement').toBeTruthy();
  expect(allocation.status, 'allocation status').toBe('allocated');
  expect(Number(allocation.qty), 'allocated quantity').toBe(ALLOCATE_QTY);
  expect(allocation.type, 'allocation Kardex direction').toBe('out');
  expect(Number(allocation.outQty), 'Kardex out quantity').toBe(ALLOCATE_QTY);
  const allocationCost = ALLOCATE_QTY * RAW_UNIT_COST;
  expect(Number(allocation.cost), 'Kardex out cost at the WAC').toBe(allocationCost);

  const allocRows = await voucherRowsOf('source_bom_allocation_id', allocationId);
  expectBalanced(allocRows);
  expect(netByAccount(allocRows), 'allocation voucher').toEqual({
    [ACCOUNTS.workInProgress]: allocationCost, [ACCOUNTS.rawMaterials]: -allocationCost,
  });
  const wipRow = allocRows.find(r => r.code === ACCOUNTS.workInProgress);
  expect(wipRow?.detailedType, 'WIP row detailed type').toBe('project');
  expect(Number(wipRow?.detailedId), 'WIP row detailed id').toBe(projectId);
  const [rawStock] = await db('SELECT current_stock::text AS stock FROM items WHERE id = $1', [rawId]);
  expect(Number(rawStock.stock), 'raw material stock after allocation').toBe(RECEIPT_QTY - ALLOCATE_QTY);

  // 2. Delivery above the plan without a reason is refused and the reason prompt opens
  await openDeliveryTab(page);
  const productCard = page.locator('div.flex', { hasText: String(setup.product.name) })
    .filter({ has: page.getByRole('button', { name: DELIVERY_TEXT.deliver, exact: true }) }).last();
  const [qtyInput, costInput] = [productCard.locator('input[type=number]').nth(0), productCard.locator('input[type=number]').nth(1)];
  await qtyInput.fill(String(PLANNED_QTY + 1));
  await costInput.fill(String(PRODUCT_UNIT_COST));
  const deliver = async (): Promise<{ status: number; body: Json }> => {
    const posted = page.waitForResponse(r => r.url().endsWith(`/api/projects/${projectId}/add-to-inventory`) && r.request().method() === 'POST');
    await productCard.getByRole('button', { name: DELIVERY_TEXT.deliver, exact: true }).click();
    const response = await posted;
    return { status: response.status(), body: await response.json() as Json };
  };
  const refused = await deliver();
  expect(refused.status, 'over-delivery answer').toBe(422);
  expect(JSON.stringify(refused.body), 'over-delivery code').toContain('OVER_DELIVERY_REASON_REQUIRED');
  const prompt = page.locator('div', { has: page.getByPlaceholder(DELIVERY_TEXT.overReason) }).filter({ hasText: DELIVERY_TEXT.overTitle }).last();
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: DELIVERY_TEXT.cancel }).click();
  const [noReceipt] = await db(`SELECT count(*)::int AS n FROM documents WHERE project_id = $1 AND type = 'production_receipt'`, [projectId]);
  expect(noReceipt.n, 'refused delivery records no receipt').toBe(0);

  // 3. Delivery of the planned quantity: a final production receipt with Kardex in rows and stock
  await qtyInput.fill(String(PLANNED_QTY));
  const delivered = await deliver();
  expect(delivered.status, 'delivery answer').toBe(200);
  await expect(page.getByText(DELIVERY_TEXT.delivered)).toBeVisible();

  const receipts = await db(
    `SELECT id, status FROM documents WHERE project_id = $1 AND type = 'production_receipt' AND is_deleted = 0`, [projectId]);
  expect(receipts.length, 'one production receipt').toBe(1);
  expect(receipts[0].status, 'production receipt status').toBe('final');
  const receiptId = Number(receipts[0].id);
  const kardexIn = await db(
    `SELECT type, quantity::text AS qty, total_price::text AS cost FROM transactions
      WHERE document_id = $1 AND item_id = $2 AND is_deleted = 0 AND reversal_of_id IS NULL`, [receiptId, productId]);
  expect(kardexIn.map(r => r.type), 'delivery Kardex direction').toEqual(['in']);
  expect(Number(kardexIn[0].qty), 'delivery Kardex quantity').toBe(PLANNED_QTY);
  const deliveryValue = PLANNED_QTY * PRODUCT_UNIT_COST;
  expect(Number(kardexIn[0].cost), 'delivery Kardex value').toBe(deliveryValue);
  const [productStock] = await db('SELECT current_stock::text AS stock FROM items WHERE id = $1', [productId]);
  expect(Number(productStock.stock), 'product stock after delivery').toBe(PLANNED_QTY);

  // 4. Delivery voucher: Dr finished goods / Cr work in progress with the project's detail
  const deliveryRows = await voucherRowsOf('source_document_id', receiptId);
  expectBalanced(deliveryRows);
  expect(netByAccount(deliveryRows), 'delivery voucher').toEqual({
    [ACCOUNTS.finishedGoods]: deliveryValue, [ACCOUNTS.workInProgress]: -deliveryValue,
  });
  const wipCredit = deliveryRows.find(r => r.code === ACCOUNTS.workInProgress);
  expect(wipCredit?.detailedType, 'WIP credit detailed type').toBe('project');
  expect(Number(wipCredit?.detailedId), 'WIP credit detailed id').toBe(projectId);
});
