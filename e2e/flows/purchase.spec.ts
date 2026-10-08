import { expect, test, type Page } from '@playwright/test';
import {
  adminApi, businessToday, closeDb, dataOf, db, expectBalanced, netByAccount, signIn, uniqueSuffix, voucherRowsOf,
  type AdminApi, type Json,
} from '../support/flowKit';

/**
 * v10 (I-02), flow "purchase": a supplier's goods enter stock through the browser and are checked down to the
 * stock tables, the Kardex rows and the purchase voucher (AGENTS.md section 3, "Purchase Line Discount in Cost").
 */
const UI = {
  supplierPicker: 'انتخاب طرف‌حساب...',
  itemPicker: 'کد یا نام کالا را تایپ کنید...',
  search: 'جستجو...',
  quantity: '0',
  unitPrice: 'مثال: 100000',
  addLine: 'افزودن به ردیف‌ها',
  submitReceipt: 'ثبت نهایی و صدور سند رسید خرید',
  receiptSaved: 'رسید خرید ثبت و موجودی انبار به‌روزرسانی شد',
  activeOrdersTab: 'فاکتورهای خرید (در انتظار تحویل انبار)',
  orderSearch: 'جستجو در شماره فاکتور، نام تامین‌کننده، کد درخواست خرید مرجع، پروژه یا اقلام...',
  deliverOrder: 'تایید و تحویل به انبار',
  confirmDelivery: 'تایید و صدور رسید قطعی انبار',
} as const;

const DATA = {
  supplierName: 'تأمین‌کننده آزمون خرید',
  itemName: 'مهره آزمون خرید',
  unit: 'عدد',
  category: 'مهره',
  requisitionTitle: 'درخواست خرید آزمون سرتاسری',
} as const;

interface Line { itemId: number; code: string; quantity: number; unitPrice: number; discount: number }
interface Mapping { inventoryRawMaterialsCode: string; tradePayablesAccountCode: string }

let api: AdminApi;
let mapping: Mapping;

test.beforeAll(async () => {
  api = await adminApi();
  const body = dataOf<Json>(await api.get('/api/accounting/mappings'));
  mapping = {
    inventoryRawMaterialsCode: String(body.inventoryRawMaterialsCode || '1401'),
    tradePayablesAccountCode: String(body.tradePayablesAccountCode || '3001'),
  };
});

test.afterAll(async () => {
  await api?.dispose();
  await closeDb();
});

async function createSupplier(suffix: string): Promise<{ id: number; name: string }> {
  const name = `${DATA.supplierName} ${suffix}`;
  const created = dataOf<Json>(await api.send('post', '/api/customers', {
    name, phone: `0935${String(Date.now()).slice(-7)}`, type: 'supplier',
  }));
  return { id: Number(created.id), name };
}

async function createItem(suffix: string, n: number): Promise<{ id: number; code: string }> {
  const code = `PUR-${suffix}-${n}`;
  const created = dataOf<Json>(await api.send('post', '/api/items', {
    type: 'raw_material', name: `${DATA.itemName} ${suffix} ${n}`, code, unit: DATA.unit, category: DATA.category,
  }));
  return { id: Number(created.id), code };
}

const lineNet = (l: Line): number => l.quantity * l.unitPrice - l.discount;

/** Final status and party, stock and WAC of fresh items, Kardex rows and the voucher of one purchase document. */
async function expectPurchaseRecorded(docId: number, supplierId: number, lines: Line[]): Promise<void> {
  const [doc] = await db('SELECT status, type AS "docType", party_id AS "partyId" FROM documents WHERE id = $1', [docId]);
  expect(doc.status, 'document is final').toBe('final');
  expect(doc.docType, 'document is a purchase receipt').toBe('receipt');
  expect(Number(doc.partyId), 'document keeps the picked supplier id').toBe(supplierId);

  for (const l of lines) {
    const [item] = await db('SELECT current_stock::text AS stock, weighted_average_cost::text AS wac FROM items WHERE id = $1', [l.itemId]);
    expect(Number(item.stock), `stock of ${l.code}`).toBe(l.quantity);
    expect(Number(item.wac), `WAC of ${l.code} is the net unit price`).toBeCloseTo(lineNet(l) / l.quantity, 4);

    const kardex = await db(
      `SELECT type, quantity::text AS quantity, unit_price::text AS "unitPrice", date::date::text AS day
         FROM transactions WHERE document_id = $1 AND item_id = $2 AND is_deleted = 0`, [docId, l.itemId]);
    expect(kardex, `one Kardex row for ${l.code}`).toHaveLength(1);
    expect(kardex[0].type, `Kardex direction of ${l.code}`).toBe('in');
    expect(Number(kardex[0].quantity), `Kardex quantity of ${l.code}`).toBe(l.quantity);
    expect(Number(kardex[0].unitPrice), `Kardex cost of ${l.code}`).toBeCloseTo(lineNet(l) / l.quantity, 4);
    expect(kardex[0].day, `Kardex date of ${l.code}`).toBe(businessToday().iso);
  }

  const rows = await voucherRowsOf('source_document_id', docId);
  expectBalanced(rows);
  expect(new Set(rows.map(r => r.voucherId)).size, 'one voucher per document').toBe(1);
  const total = lines.reduce((s, l) => s + lineNet(l), 0);
  const net = netByAccount(rows);
  expect(net[mapping.inventoryRawMaterialsCode], 'raw materials debited with the net').toBeCloseTo(total, 2);
  expect(net[mapping.tradePayablesAccountCode], 'trade payables credited with the net').toBeCloseTo(-total, 2);
  expect(Object.keys(net).sort(), 'no other account in the voucher')
    .toEqual([mapping.inventoryRawMaterialsCode, mapping.tradePayablesAccountCode].sort());
  const payable = rows.filter(r => r.code === mapping.tradePayablesAccountCode);
  for (const r of payable) {
    expect(['supplier', 'customer'], 'payables detail type is the party').toContain(r.detailedType);
    expect(Number(r.detailedId), 'payables detail is the supplier id').toBe(supplierId);
  }
}

async function pickOption(page: Page, pickerName: string, search: string): Promise<void> {
  await page.getByRole('button', { name: pickerName }).click();
  await page.getByPlaceholder(UI.search).fill(search);
  await page.locator('li', { hasText: search }).first().click();
}

test('purchase receipt on the stock page moves stock, Kardex and the payables voucher', async ({ page }) => {
  const suffix = uniqueSuffix();
  const supplier = await createSupplier(suffix);
  const a = await createItem(suffix, 1);
  const b = await createItem(suffix, 2);
  // The stock page offers no line discount, so both lines carry none here (the procurement test covers it).
  const lines: Line[] = [
    { itemId: a.id, code: a.code, quantity: 4, unitPrice: 250000, discount: 0 },
    { itemId: b.id, code: b.code, quantity: 3, unitPrice: 120000, discount: 0 },
  ];

  await signIn(page);
  await page.goto('/receipts');
  await pickOption(page, UI.supplierPicker, supplier.name);
  for (const l of lines) {
    await pickOption(page, UI.itemPicker, l.code);
    await page.getByPlaceholder(UI.quantity, { exact: true }).fill(String(l.quantity));
    await page.getByPlaceholder(UI.unitPrice).fill(String(l.unitPrice));
    await page.getByRole('button', { name: UI.addLine }).click();
  }

  const created = page.waitForResponse(r => r.url().endsWith('/api/documents') && r.request().method() === 'POST');
  await page.getByRole('button', { name: UI.submitReceipt }).click();
  const response = await created;
  const body = await response.json() as Json;
  expect(response.status(), `create answer ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
  await expect(page.getByText(UI.receiptSaved)).toBeVisible();

  await expectPurchaseRecorded(Number(body.docId), supplier.id, lines);
});

test('procurement order with a line discount delivered from the procurement desk', async ({ page }) => {
  const suffix = uniqueSuffix();
  const supplier = await createSupplier(suffix);
  const c = await createItem(suffix, 3);
  const d = await createItem(suffix, 4);
  const lines: Line[] = [
    { itemId: c.id, code: c.code, quantity: 5, unitPrice: 200000, discount: 0 },
    { itemId: d.id, code: d.code, quantity: 3, unitPrice: 100000, discount: 30000 },
  ];

  const requisition = dataOf<Json>(await api.send('post', '/api/procurement/requisitions', {
    title: `${DATA.requisitionTitle} ${suffix}`,
    items: lines.map(l => ({ itemId: l.itemId, itemCode: l.code, unit: DATA.unit, requestedQty: l.quantity, unitPriceEstimate: l.unitPrice })),
  }));
  const converted = dataOf<{ createdDocuments: { id: number; refNumber: string }[] }>(await api.send(
    'post', `/api/procurement/requisitions/${Number(requisition.id)}/convert-to-orders`, {
      orderGroups: [{
        supplierId: supplier.id, supplierName: supplier.name, docType: 'receipt', status: 'draft',
        items: lines.map(l => ({ itemId: l.itemId, itemCode: l.code, unit: DATA.unit, quantity: l.quantity, unitPrice: l.unitPrice })),
      }],
    }));
  expect(converted.createdDocuments, 'one draft order').toHaveLength(1);
  const order = converted.createdDocuments[0];

  // The order forms take no discount; the draft order is edited through the document API to carry one.
  const [stored] = await db(
    `SELECT di.location, d.date::date::text AS day FROM documents d JOIN document_items di ON di.document_id = d.id
      WHERE d.id = $1 AND di.is_deleted = 0 LIMIT 1`, [order.id]);
  await api.send('put', `/api/documents/${order.id}`, {
    docType: 'receipt', status: 'draft', inOut: 'in', partyId: supplier.id, buyer_name: supplier.name,
    location: stored.location, currency: 'IRR', date: stored.day,
    items: lines.map(l => ({ itemId: l.itemId, quantity: l.quantity, unit_price: l.unitPrice, discount: l.discount, location: stored.location })),
  });

  await signIn(page);
  await page.goto('/procurement');
  await page.getByRole('button', { name: UI.activeOrdersTab }).first().click();
  await page.getByPlaceholder(UI.orderSearch).fill(order.refNumber);
  const row = page.locator('tr', { hasText: order.refNumber });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: UI.deliverOrder }).click();
  const delivered = page.waitForResponse(r => r.url().endsWith(`/api/procurement/orders/${order.id}/deliver`));
  await page.getByRole('button', { name: UI.confirmDelivery }).click();
  const response = await delivered;
  expect(response.status(), `deliver answer ${(await response.text()).slice(0, 300)}`).toBe(200);

  await expectPurchaseRecorded(order.id, supplier.id, lines);
});
