import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, journalVouchers, productionProjects, projectBomAllocations, transactions, warehouses } from '../../db/schema.js';
import { normalizeError } from '../../errors/customErrors.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * v11 phase 3.2 (urgent stock fixes of the independent evaluation): S1, an Excel import changed the type of an item with
 * stock, so later movements credited the other inventory account; S3, an item could be deleted while a BOM allocation of it
 * was open, and the release put stock and value back on the deleted item. Each case fails on the code before the fix.
 */
export async function runStockUrgentFixesTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['reg_item_excel_type_change_with_history_s1',
      'v11 phase 3.2 (S1): an Excel row does not change the type of an item with stock or a Kardex row (row error, nothing written); an item without either still changes',
      ['s1', 'item', 'excel', 'inventory', 'phase3'], excelTypeChangeCase],
    ['reg_item_delete_open_allocation_s3',
      'v11 phase 3.2 (S3): an item with an open BOM allocation or a project reservation is not deleted (409); once the allocation is consumed and the project closed, it is',
      ['s3', 'item', 'allocation', 'inventory', 'phase3'], deleteWithDependentsCase],
    ['reg_bom_release_deleted_item_s3',
      'v11 phase 3.2 (S3): the release of an allocation whose item was deleted is refused (409) and moves nothing; no stock movement is recorded on a deleted item except a stock count decrease, which writes off stock left on it; the financial health check lists a deleted item with stock or an open allocation',
      ['s3', 'allocation', 'inventory', 'health', 'phase3'], releaseDeletedItemCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeCtx();
    try {
      const details = await run(ctx);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await ctx.cleanup().catch(() => undefined);
    }
  }
  return results;
}

interface Ctx {
  tag: string;
  warehouse: string;
  post(url: string, body: unknown): Promise<request.Response>;
  del(url: string): Promise<request.Response>;
  /** a live item made through POST /api/items, with `stock` units brought in at `cost` through the stock engine */
  item(type: 'raw_material' | 'product', label: string, stock: number, cost?: number): Promise<{ id: number; code: string; name: string }>;
  project(label: string, reservedItem?: { id: number; code: string; name: string }): Promise<number>;
  cleanup(): Promise<void>;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const { DocumentService } = await import('../../services/document.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const tag = String(1000 + Math.floor(Math.random() * 9000));
  const [wh] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
  const itemIds: number[] = [];
  const projectIds: number[] = [];
  const post = (url: string, body: unknown) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body as object);
  return {
    tag,
    warehouse: wh.code,
    post,
    del: (url) => request(app).delete(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
    async item(type, label, stock, cost = 100) {
      const code = type === 'raw_material' ? `S3R-${tag}-${label}` : `S3P-${tag}-${label}`;
      const name = `کالای فاز ۳ ${tag} ${label}`;
      const res = await post('/api/items', {
        type, code, name, unit: 'عدد', category: type === 'raw_material' ? 'سایر اقلام' : 'گردنبند', weighted_average_cost: cost,
      });
      if (res.status !== 200 || typeof res.body?.id !== 'number') throw new Error(`POST /items ${code} answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      itemIds.push(res.body.id);
      if (stock > 0) {
        const today = await businessTodayIsoDate();
        await orm.transaction(tx => DocumentService.applyStockMovement(tx, {
          itemId: res.body.id, inOut: 'in', quantity: stock, price: cost, date: today, documentType: 'audit', documentRef: `S3-${tag}`, user: 'test', targetLoc: wh.code,
        }));
      }
      return { id: res.body.id as number, code, name };
    },
    async project(label, reservedItem) {
      const [p] = await orm.insert(productionProjects).values({
        projectCode: `PRJ-S3-${tag}-${label}`, title: `پروژه فاز ۳ ${tag} ${label}`, status: 'in_progress', quantity: 1, version: 1, isDeleted: 0,
        ...(reservedItem ? {
          inventoryControl: { isFinalized: true, isReserved: true, reservedItems: [{ itemId: reservedItem.id, itemCode: reservedItem.code, itemName: reservedItem.name, reservedQty: 2, unit: 'عدد' }] },
        } : {}),
      }).returning({ id: productionProjects.id });
      projectIds.push(p.id);
      return p.id;
    },
    async cleanup() {
      if (projectIds.length > 0) {
        await orm.update(projectBomAllocations).set({ status: 'consumed' })
          .where(and(inArray(projectBomAllocations.projectId, projectIds), eq(projectBomAllocations.status, 'allocated')));
        await orm.update(productionProjects).set({ status: 'completed', inventoryControl: {} }).where(inArray(productionProjects.id, projectIds));
      }
      // the items keep their test stock; cleanup only hides them like the other item suites
      if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds));
    },
  };
}

async function itemRow(id: number) {
  const [row] = await orm.select({ type: items.type, version: items.version, isDeleted: items.isDeleted, stock: items.currentStock, wac: items.weightedAverageCost })
    .from(items).where(eq(items.id, id));
  return row;
}

const errorsText = (body: { errors?: Array<{ message?: string }> }) => (body.errors ?? []).map(e => e.message ?? '').join(' | ');

async function excelTypeChangeCase(ctx: Ctx): Promise<string> {
  const stocked = await ctx.item('raw_material', 'T1', 10);
  const before = await itemRow(stocked.id);
  const refused = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': stocked.code, 'نام محصول': stocked.name, 'نوع کالا': 'محصول نهایی' }] });
  const afterRefused = await itemRow(stocked.id);
  if (refused.status !== 200 || afterRefused.type !== 'raw_material' || afterRefused.version !== before.version || !errorsText(refused.body).includes('نوع کالای')) {
    throw new Error(`type change of an item with 10 in stock: ${refused.status}, type ${afterRefused.type}, version ${before.version} → ${afterRefused.version}, errors «${errorsText(refused.body).slice(0, 200)}»`);
  }

  // stock back to zero by the file itself: the Kardex rows stay, so the type still does not change
  const emptied = await ctx.item('raw_material', 'T2', 3);
  const zero = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': emptied.code, 'نام محصول': emptied.name, 'موجودی کل': 0 }] });
  const zeroRow = await itemRow(emptied.id);
  if (zero.status !== 200 || Number(zeroRow.stock) !== 0) throw new Error(`Excel decrease to 0 answered ${zero.status}, stock ${zeroRow.stock}, errors «${errorsText(zero.body)}»`);
  const historyOnly = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': emptied.code, 'نام محصول': emptied.name, 'نوع کالا': 'محصول نهایی' }] });
  if ((await itemRow(emptied.id)).type !== 'raw_material' || !errorsText(historyOnly.body).includes('نوع کالای')) {
    throw new Error(`type change of an item with Kardex rows and no stock was accepted (errors «${errorsText(historyOnly.body).slice(0, 200)}»)`);
  }

  // the same row cannot change the type and bring stock in either: the row is refused whole
  const unchanged = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': stocked.code, 'نام محصول': stocked.name, 'نوع کالا': 'محصول نهایی', 'موجودی کل': 15 }] });
  const afterBoth = await itemRow(stocked.id);
  if (afterBoth.type !== 'raw_material' || Number(afterBoth.stock) !== 10) {
    throw new Error(`a row with a type change and a stock increase wrote type ${afterBoth.type} and stock ${afterBoth.stock} (errors «${errorsText(unchanged.body).slice(0, 160)}»)`);
  }

  // an item without stock and without a Kardex row still changes its type, and the same type is no change
  const fresh = await ctx.item('raw_material', 'T3', 0);
  const changed = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': fresh.code, 'نام محصول': fresh.name, 'نوع کالا': 'محصول نهایی' }] });
  const same = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': stocked.code, 'نام محصول': stocked.name, 'نوع کالا': 'ماده اولیه' }] });
  if ((await itemRow(fresh.id)).type !== 'product' || errorsText(changed.body) !== '' || errorsText(same.body) !== '') {
    throw new Error(`fresh item type ${(await itemRow(fresh.id)).type}, errors «${errorsText(changed.body)}» / same type «${errorsText(same.body)}»`);
  }
  return `stocked item kept raw_material (${String(refused.body.errors?.[0]?.message ?? '').slice(0, 60)}…); emptied item with Kardex rows kept its type; fresh item became product`;
}

async function deleteWithDependentsCase(ctx: Ctx): Promise<string> {
  const { ProjectBomAllocationService } = await import('../../services/inventory/projectBomAllocation.service.js');
  const material = await ctx.item('raw_material', 'D1', 6, 700);
  const projectId = await ctx.project('D1');
  const alloc = await ProjectBomAllocationService.allocateMaterialsForProject({
    projectId, allocations: [{ itemId: material.id, quantity: 6, location: ctx.warehouse }], username: 'test',
  });
  const allocationId = alloc.allocations[0].id;
  const refused = await ctx.del(`/api/items/${material.id}`);
  if (refused.status !== 409 || refused.body?.code !== 'ITEM_HAS_OPEN_ALLOCATION' || (await itemRow(material.id)).isDeleted !== 0) {
    throw new Error(`delete with an open allocation answered ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}; deleted ${(await itemRow(material.id)).isDeleted}`);
  }
  await ProjectBomAllocationService.consumeAllocation(allocationId, { username: 'test' });
  const afterConsume = await ctx.del(`/api/items/${material.id}`);
  if (afterConsume.status !== 200 || (await itemRow(material.id)).isDeleted !== 1) {
    throw new Error(`delete after the allocation was consumed answered ${afterConsume.status} ${JSON.stringify(afterConsume.body).slice(0, 200)}`);
  }

  const reserved = await ctx.item('raw_material', 'D2', 0);
  const reservingProject = await ctx.project('D2', reserved);
  const reservedRefused = await ctx.del(`/api/items/${reserved.id}`);
  if (reservedRefused.status !== 409 || reservedRefused.body?.code !== 'ITEM_HAS_PROJECT_RESERVATION' || (await itemRow(reserved.id)).isDeleted !== 0) {
    throw new Error(`delete of an item a finalized project reserves answered ${reservedRefused.status} ${JSON.stringify(reservedRefused.body).slice(0, 200)}`);
  }
  await orm.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, reservingProject));
  const afterClose = await ctx.del(`/api/items/${reserved.id}`);
  if (afterClose.status !== 200) throw new Error(`delete after the reserving project completed answered ${afterClose.status} ${JSON.stringify(afterClose.body).slice(0, 200)}`);
  return `open allocation → 409 ${refused.body.code}, consumed → deleted; reserved by a project → 409 ${reservedRefused.body.code}, project completed → deleted`;
}

async function releaseDeletedItemCase(ctx: Ctx): Promise<string> {
  const { ProjectBomAllocationService } = await import('../../services/inventory/projectBomAllocation.service.js');
  const { DocumentService } = await import('../../services/document.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { findDeletedItemsWithStock } = await import('../../services/accounting/deletedItemStockHealth.js');
  const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');

  // an allocation left open on an item deleted before this phase (the delete did not check allocations then)
  const material = await ctx.item('raw_material', 'R1', 6, 700);
  const projectId = await ctx.project('R1');
  const alloc = await ProjectBomAllocationService.allocateMaterialsForProject({
    projectId, allocations: [{ itemId: material.id, quantity: 6, location: ctx.warehouse }], username: 'test',
  });
  const allocationId = alloc.allocations[0].id;
  await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, material.id));
  const listedOpen = (await findDeletedItemsWithStock(orm)).find(r => Number(r.itemId) === material.id);
  if (!listedOpen || Number(listedOpen.openAllocations) !== 1) throw new Error(`the health check did not list the deleted item with its open allocation (${JSON.stringify(listedOpen)})`);

  const release = await ctx.post(`/api/inventory/allocations/${allocationId}/release`, { reason: 'آزمون فاز ۳' });
  const [allocRow] = await orm.select({ status: projectBomAllocations.status }).from(projectBomAllocations).where(eq(projectBomAllocations.id, allocationId));
  const [voucher] = await orm.select({ isDeleted: journalVouchers.isDeleted, status: journalVouchers.status }).from(journalVouchers)
    .where(eq(journalVouchers.sourceBomAllocationId, allocationId));
  const after = await itemRow(material.id);
  if (release.status !== 409 || release.body?.code !== 'ALLOCATION_ITEM_DELETED' || Number(after.stock) !== 0 || allocRow.status !== 'allocated' || voucher?.isDeleted !== 0) {
    throw new Error(`release on a deleted item answered ${release.status} ${JSON.stringify(release.body).slice(0, 200)}; stock ${after.stock}, allocation ${allocRow.status}, voucher ${JSON.stringify(voucher)}`);
  }

  // no path moves stock on a deleted item: the stock engine refuses it under the item lock
  const today = await businessTodayIsoDate();
  let engineCode = 'accepted';
  try {
    await orm.transaction(tx => DocumentService.applyStockMovement(tx, {
      itemId: material.id, inOut: 'in', quantity: 2, price: 700, date: today, documentType: 'audit', documentRef: `S3-${ctx.tag}-engine`, user: 'test', targetLoc: ctx.warehouse,
    }));
  } catch (err) {
    engineCode = normalizeError(err).code ?? 'error';
  }
  const kardexIn = await orm.select({ id: transactions.id }).from(transactions)
    .where(and(eq(transactions.itemId, material.id), eq(transactions.documentRef, `S3-${ctx.tag}-engine`)));
  if (engineCode !== 'ITEM_DELETED' || kardexIn.length > 0) throw new Error(`a movement on a deleted item ended as ${engineCode} with ${kardexIn.length} Kardex row(s)`);

  // the allocation can still be consumed, and then the deleted item is no longer listed
  await ProjectBomAllocationService.consumeAllocation(allocationId, { username: 'test' });
  if ((await findDeletedItemsWithStock(orm)).some(r => Number(r.itemId) === material.id)) throw new Error('the deleted item is still listed after its allocation was consumed');

  // stock already left on a deleted item (released before this phase) is listed with its value
  const stranded = await ctx.item('raw_material', 'R2', 4, 250);
  await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, stranded.id));
  const report = await FinancialHealthService.runHealthCheck();
  const test = report.tests.find(t => t.id === 'item_deleted_with_stock');
  const listed = test?.items?.find(i => Number(i.id) === stranded.id);
  if (!test || test.status !== 'warning' || !listed || Number(listed.amount) !== 1000) {
    throw new Error(`health check item_deleted_with_stock: ${JSON.stringify({ status: test?.status, listed }).slice(0, 240)}`);
  }

  // that stock is written off by a stock count to zero (Dr 7012 at its cost); a count above the book stock is refused
  const count = (book: number, counted: number) => ctx.post('/api/documents', {
    docType: 'audit', refNumber: 'auto', date: today, location: ctx.warehouse, status: 'final',
    items: [{ itemId: stranded.id, system_stock: book, physical_stock: counted, quantity: counted, location: ctx.warehouse }],
  });
  const gain = await count(4, 6);
  if (gain.status !== 409 || gain.body?.code !== 'ITEM_DELETED' || Number((await itemRow(stranded.id)).stock) !== 4) {
    throw new Error(`a stock count gain on a deleted item answered ${gain.status} ${JSON.stringify(gain.body).slice(0, 160)}`);
  }
  const writeOff = await count(4, 0);
  const docId = Number(writeOff.body?.docId ?? 0);
  const [countVoucher] = docId > 0
    ? await orm.select({ id: journalVouchers.id }).from(journalVouchers).where(and(eq(journalVouchers.sourceDocumentId, docId), eq(journalVouchers.isDeleted, 0)))
    : [];
  if (writeOff.status !== 200 || Number((await itemRow(stranded.id)).stock) !== 0 || !countVoucher
    || (await findDeletedItemsWithStock(orm)).some(r => Number(r.itemId) === stranded.id)) {
    throw new Error(`the stock count write-off of a deleted item answered ${writeOff.status} ${JSON.stringify(writeOff.body).slice(0, 160)}; stock ${(await itemRow(stranded.id)).stock}, voucher ${countVoucher?.id ?? 'none'}`);
  }
  return `release → 409 ${release.body.code}, nothing moved; engine → ${engineCode}; consumed allocation unlisted; stranded stock listed at ${listed.amount}, written off by a stock count (voucher ${countVoucher.id})`;
}
