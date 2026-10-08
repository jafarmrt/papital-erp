import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, roles, users } from '../../db/schema.js';

/**
 * بسته ۹ (مشتریان و CRM) — یافته‌های سرور در مسیرهای واقعی Express؛ هر آزمون روی کد پیشین قرمز است.
 */

interface Session { cookie: string; csrfToken: string }

interface CardBody {
  items?: Array<{ detailedId?: number | null; detailedName?: string; debit: number; credit: number; isOpening?: boolean }>;
  finalBalance?: number;
}

export async function runPartyAccountCardTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_customer_account_card_by_party_td_416';
  if (!shouldRun(id, 'td416', 'customer', 'account_card', 'crm', 'package9')) return results;

  const name = 'v9.0.4: a party\'s account card is read by its id; another party\'s balance with a similar name is not added and a rename does not zero the card (TD-416)';
  const tStart = Date.now();
  const createdCustomerIds: number[] = [];
  const createdRoleIds: number[] = [];
  const createdUserIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer, createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { VoucherService } = await import('../../services/accounting/voucher.service.js');
    const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { pool } = await import('../../db/drizzle.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const get = (url: string, s: Session = admin) => request(app).get(url).set('Cookie', s.cookie);
    const today = await businessTodayIsoDate();
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const receivable = await AccountMappingService.getTradeReceivablesAccount();
    const payable = await AccountMappingService.getTradePayablesAccount();
    if (!receivable || !payable) throw new Error('The trade receivables or trade payables account is not in the account mapping');

    const finalInvoice = async (buyerName: string, unitPrice: number): Promise<void> => {
      const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 100000 });
      const docId = await DocumentService.createDocument({
        docType: 'invoice', inOut: 'out', status: 'final', date: today, user: 'td416', buyerName,
        items: [{ itemId: item.id, quantity: 1, unitPrice, location: wh }],
      } as Parameters<typeof DocumentService.createDocument>[0]);
      const voucher = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [docId]);
      await VoucherService.approveJournalVouchers(voucher.rows.map(r => Number(r.id)));
    };
    const manualVoucher = async (rows: Array<{ detailedType: string; detailedId: number | null; detailedName: string; debit: number; credit: number }>): Promise<void> => {
      const total = rows.reduce((s, r) => s + r.debit - r.credit, 0);
      await VoucherService.createJournalVoucher({
        date: today, status: 'approved', description: 'آزمون TD-416',
        items: [
          ...rows.map(r => ({ accountId: r.debit > 0 ? receivable.id : payable.id, ...r })),
          { accountId: payable.id, detailedType: 'none', debit: total < 0 ? -total : 0, credit: total > 0 ? total : 0 },
        ],
      });
    };

    const tag = String(Date.now()).slice(-6);
    const a = await createTestCustomer({ name: `علی کاظمی ${tag}`, phone: `0912${tag}1`, partyType: 'both' });
    const b = await createTestCustomer({ name: `علی کاظمی ${tag}نژاد`, phone: `0912${tag}2` });
    createdCustomerIds.push(a.id, b.id);

    // A: فروش ۱٬۰۰۰٬۰۰۰ (ردیف مشتری با شناسه)؛ B که نامش نام A را دارد: فروش ۵٬۰۰۰٬۰۰۰
    await finalInvoice(a.name, 1_000_000);
    await finalInvoice(b.name, 5_000_000);
    // A «هر دو» است: ردیف تأمین‌کننده با شناسه A، بستانکار ۴۰۰٬۰۰۰
    await manualVoucher([{ detailedType: 'supplier', detailedId: a.id, detailedName: a.name, debit: 0, credit: 400_000 }]);
    // ردیف قدیمیِ بی‌شناسه با نام دقیق A (۲۰۰٬۰۰۰) و با نام B که نام A را دارد (۷٬۰۰۰)
    await manualVoucher([
      { detailedType: 'customer', detailedId: null, detailedName: a.name, debit: 200_000, credit: 0 },
      { detailedType: 'customer', detailedId: null, detailedName: b.name, debit: 7_000, credit: 0 },
    ]);

    const wrong: string[] = [];
    const card = async (customerId: number, s: Session = admin): Promise<{ status: number; body: CardBody }> => {
      const r = await get(`/api/customers/${customerId}/account-card`, s);
      return { status: r.status, body: (r.body?.report ?? r.body) as CardBody };
    };
    const ledgerRows = (body: CardBody) => (body.items ?? []).filter(i => !i.isOpening);

    // ۱) کارت A: ۱٬۰۰۰٬۰۰۰ + ۲۰۰٬۰۰۰ − ۴۰۰٬۰۰۰ = ۸۰۰٬۰۰۰؛ ردیف‌های B (با شناسه یا بی‌شناسه) نمی‌آیند
    const first = await card(a.id);
    if (first.status !== 200) throw new Error(`account card A returned status ${first.status}: ${JSON.stringify(first.body).slice(0, 200)}`);
    if (first.body.finalBalance !== 800_000) wrong.push(`card A balance is ${first.body.finalBalance}, not 800,000`);
    const foreign = ledgerRows(first.body).filter(r => r.detailedId === b.id || r.detailedName === b.name);
    if (foreign.length > 0) wrong.push(`${foreign.length} rows of B appeared in card A`);
    if (ledgerRows(first.body).length !== 3) wrong.push(`card A has ${ledgerRows(first.body).length} rows, not 3`);

    // ۲) کارت B فقط خودش: ۵٬۰۰۰٬۰۰۰ + ۷٬۰۰۰
    const second = await card(b.id);
    if (second.body.finalBalance !== 5_007_000) wrong.push(`card B balance is ${second.body.finalBalance}, not 5,007,000`);

    // ۳) تغییر نام A با فرم طرف حساب: ردیف‌های شناسه‌دار می‌مانند (۱٬۰۰۰٬۰۰۰ − ۴۰۰٬۰۰۰)؛ ردیف بی‌شناسه نام قدیم را دارد
    const renamed = await request(app).put(`/api/customers/${a.id}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ name: `علی کاظمی ${tag} (فروشگاه مرکزی)`, phone: a.phone, partyType: 'both', version: a.version });
    if (renamed.status !== 200) throw new Error(`renaming A returned status ${renamed.status}`);
    const third = await card(a.id);
    if (third.body.finalBalance !== 600_000) wrong.push(`after the rename, card A balance is ${third.body.finalBalance}, not 600,000`);

    // ۴) دسترسی: همان مجوزهای کارت حساب؛ دارنده فقط «ورود کالا» (انتخابگر طرف حساب) مانده را نمی‌بیند
    const viewerRole = await createTestRole({ permissions: ['customers.view'] });
    const pickerRole = await createTestRole({ permissions: ['warehouse.in'] });
    createdRoleIds.push(viewerRole.id, pickerRole.id);
    const viewer = await createTestUser({ role: viewerRole.code });
    const picker = await createTestUser({ role: pickerRole.code });
    createdUserIds.push(viewer.id, picker.id);
    const viewerCard = await card(a.id, await loginTestUserWithSession(app, viewer.username));
    const pickerCard = await card(a.id, await loginTestUserWithSession(app, picker.username));
    if (viewerCard.status !== 200) wrong.push(`the customers.view holder did not get the card (status ${viewerCard.status})`);
    if (pickerCard.status !== 403) wrong.push(`a holder of only warehouse.in got the card with ${pickerCard.status}, not 403`);

    // ۵) طرف حساب ناموجود
    const missing = await get('/api/customers/987654321/account-card');
    if (missing.status !== 404) wrong.push(`the card of a missing party returned ${missing.status}, not 404`);

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Card A by id: 800,000 (sale, supplier row and id-less row with the exact name; no row of B); B: 5,007,000; after the rename 600,000; customers.view 200, warehouse.in 403, missing 404',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (createdUserIds.length > 0) await orm.delete(users).where(inArray(users.id, createdUserIds)).catch(() => undefined);
    if (createdRoleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, createdRoleIds)).catch(() => undefined);
    // طرف حساب‌ها حذف نرم می‌شوند؛ سندهای فروش و ردیف‌های حسابداری آن‌ها مثل بقیه آزمون‌ها در اسکیمای آزمون می‌مانند
    if (createdCustomerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, createdCustomerIds)).catch(() => undefined);
  }
  return results;
}
