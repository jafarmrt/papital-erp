import request from 'supertest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { documentItems, documents, items, transactions, warehouses } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-489 / B06-10 and the void part of B06-04 (decision t2): every warehouse transfer
 * is a «transfer» document with its own number series, the user's reference number and notes, one line and two Kardex
 * rows linked by document_id; it is listed with its source and destination and is voided through deleteDocument, which
 * moves the quantity back without changing WAC (the Kardex replay agrees). A void whose destination stock was consumed
 * is refused (TD-265). On v9.0.79 a transfer made no document and could not be voided.
 */

export async function runWarehouseTransferDocumentTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_warehouse_transfer_document_td_489';
  if (!shouldRun(id, 'td489', 'transfer', 'void', 'inventory', 'package6')) return results;

  const name = 'v9.0.80: a warehouse transfer is a numbered transfer document, listed with source and destination, and voided without changing WAC (TD-489)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const docIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
    const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { replayKardexWac } = await import('../../services/inventory/kardexReplay.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const [mainRow] = await orm.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.code, main));
    const wh2 = await createTestWarehouse();
    const a = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    itemIds.push(a.id);
    // opening stock through the Kardex, so the replay below sees the whole history
    await DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td489', buyerName: 'td489',
      location: main, items: [{ itemId: a.id, quantity: 10, unit_price: 1000, location: main }],
    });

    const wrong: string[] = [];
    const stockOf = async (code: string) => (await ItemWarehouseStockService.getStocksForItems(orm, [a.id])).get(a.id)?.byCode[code] ?? 0;
    const wacOf = async () => Number((await orm.select({ w: items.weightedAverageCost }).from(items).where(eq(items.id, a.id)))[0]?.w ?? NaN);
    const transfer = (quantity: number, refNumber: string, notes: string) => request(app)
      .post('/api/inventory/transfer')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ itemId: a.id, fromLocation: main, toLocation: wh2.code, quantity, date: today, refNumber, notes });
    const transferDoc = async (docId: number) => (await orm.select().from(documents)
      .where(and(eq(documents.id, docId), eq(documents.type, 'transfer'))))[0];

    // 1) the transfer makes a document with the form's number and notes, one line and two linked Kardex rows
    const nextRef = String((await request(app).get('/api/documents/next-ref?type=transfer').set('Cookie', admin.cookie)).body?.nextRef ?? '');
    const first = await transfer(4, nextRef, 'td489 note');
    const firstId = Number(first.body?.data?.transferDocId);
    const doc1 = first.status === 200 ? await transferDoc(firstId) : undefined;
    if (!doc1) throw new Error(`transfer answered ${first.status}; transferDocId ${firstId} is not a transfer document (${JSON.stringify(first.body).slice(0, 200)})`);
    docIds.push(doc1.id);
    if (doc1.refNumber !== nextRef || first.body?.data?.refNumber !== nextRef) wrong.push(`document number ${doc1.refNumber} / ${first.body?.data?.refNumber}, expected the form's ${nextRef}`);
    if (doc1.notes !== 'td489 note' || doc1.status !== 'final') wrong.push(`document notes "${doc1.notes}" status ${doc1.status}`);
    const lines = await orm.select().from(documentItems).where(and(eq(documentItems.documentId, doc1.id), eq(documentItems.isDeleted, 0)));
    if (lines.length !== 1 || Number(lines[0].quantity) !== 4 || lines[0].location !== main) wrong.push(`document lines ${JSON.stringify(lines.map(l => [l.quantity, l.location]))}`);
    const kardex = await orm.select({ type: transactions.type, location: transactions.location, ref: transactions.documentRef }).from(transactions)
      .where(and(eq(transactions.documentId, doc1.id), eq(transactions.isDeleted, 0)));
    const kardexKey = kardex.map(k => `${k.type}:${k.location}:${k.ref}`).sort().join(',');
    if (kardexKey !== [`in:${wh2.code}:${nextRef}`, `out:${main}:${nextRef}`].sort().join(',')) wrong.push(`Kardex rows ${kardexKey}`);

    // 2) v9.0.327 (TD-783): a repeated number is refused with 409 DOCUMENT_REF_TAKEN (no silent swap); "auto" takes the next one in the series
    const repeated = await transfer(3, nextRef, 'td489 repeated');
    if (repeated.status !== 409 || repeated.body?.code !== 'DOCUMENT_REF_TAKEN') wrong.push(`a repeated transfer number answered ${repeated.status} ${repeated.body?.code}, expected 409 DOCUMENT_REF_TAKEN`);
    const second = await transfer(3, 'auto', 'td489 second');
    const doc2 = second.status === 200 ? await transferDoc(Number(second.body?.data?.transferDocId)) : undefined;
    if (!doc2) wrong.push(`second transfer answered ${second.status}`);
    else {
      docIds.push(doc2.id);
      if (doc2.refNumber === nextRef) wrong.push('a repeated transfer number was stored twice');
    }

    // 3) the transfers tab lists the document with its source and destination warehouse
    const list = await request(app).get('/api/documents?type=transfer&page=1&limit=50').set('Cookie', admin.cookie);
    const listed = (Array.isArray(list.body?.data) ? list.body.data : []).find((d: { id: number }) => d.id === doc1.id);
    if (!listed || listed.sourceLocation !== (mainRow?.name || main) || listed.destinationLocation !== wh2.name) {
      wrong.push(`list row ${JSON.stringify(listed ? { s: listed.sourceLocation, d: listed.destinationLocation } : null)}, expected ${mainRow?.name} -> ${wh2.name}`);
    }

    // 4) WAC moves after the transfers; voiding the first transfer brings its 4 units back to the source, WAC unchanged
    await DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td489', buyerName: 'td489',
      location: main, items: [{ itemId: a.id, quantity: 4, unit_price: 2000, location: main }],
    });
    const wacBefore = await wacOf();
    const voided = await request(app).delete(`/api/documents/${doc1.id}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    if (voided.status !== 200) wrong.push(`void of the first transfer answered ${voided.status}: ${JSON.stringify(voided.body).slice(0, 200)}`);
    if ((await stockOf(main)) !== 11 || (await stockOf(wh2.code)) !== 3) wrong.push(`after the void ${main}=${await stockOf(main)} ${wh2.code}=${await stockOf(wh2.code)}, expected 11 and 3`);
    const wacAfter = await wacOf();
    if (wacAfter !== wacBefore || wacBefore === 1000) wrong.push(`WAC before the void ${wacBefore}, after ${wacAfter} (expected unchanged and moved by the receipt)`);

    // 5) the second transfer is consumed at the destination: its void is refused and nothing moves
    await DocumentService.createDocument({
      docType: 'remittance', status: 'final', inOut: 'out', date: today, user: 'td489', buyerName: 'td489',
      location: wh2.code, items: [{ itemId: a.id, quantity: 3, unit_price: 0, location: wh2.code }],
    });
    if (doc2) {
      const refused = await request(app).delete(`/api/documents/${doc2.id}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
      if (refused.status < 400 || refused.body?.details?.code !== 'VOID_BREAKS_STOCK_HISTORY') wrong.push(`void of a consumed transfer answered ${refused.status} ${refused.body?.details?.code}`);
    }
    if ((await stockOf(main)) !== 11 || (await stockOf(wh2.code)) !== 0) wrong.push(`after the refused void ${main}=${await stockOf(main)} ${wh2.code}=${await stockOf(wh2.code)}, expected 11 and 0`);

    // 6) the Kardex replay (rebuild and running Kardex) agrees with the live stock and WAC
    const rows = await orm.select({
      id: transactions.id, type: transactions.type, quantity: transactions.quantity, unitPrice: transactions.unitPrice,
      documentType: transactions.documentType, documentRef: transactions.documentRef, reversalOfId: transactions.reversalOfId, isDeleted: transactions.isDeleted,
    }).from(transactions).where(eq(transactions.itemId, a.id)).orderBy(asc(transactions.id));
    const replay = replayKardexWac(rows, 0);
    if (replay.balance.toNumber() !== 11 || replay.wac.toNumber() !== wacAfter) wrong.push(`Kardex replay balance ${replay.balance.toString()} WAC ${replay.wac.toString()}, live 11 and ${wacAfter}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'transfer document with the form number, notes, one line and two linked Kardex rows; repeated number refused and "auto" advanced; listed with source and destination; void moved 4 back with WAC unchanged; consumed transfer void refused; replay matched',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
