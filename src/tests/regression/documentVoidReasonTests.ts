import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/**
 * TD-1241 (roles-c Rc17): voiding a document whose voucher is approved gives a reversal voucher whose description names
 * the document type in Persian. Red on v10.0.180, where it read «حذف سند انبار شماره … (invoice)».
 */

const SALES_INVOICE_NAME = 'فاکتور فروش';

export async function runDocumentVoidReasonTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_document_void_reason_td_1241', 'td-1241', 'void_reason')) {
    await runCase(results, 'reg_document_void_reason_td_1241', 'TD-1241: the reversal of a voided invoice names the document type in Persian, never its code', () => inFiscalSandbox(async () => {
      const today = await businessTodayIsoDate();
      const wh = await createTestWarehouse();
      const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
      await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td1241', buyerName: 'td1241 supplier',
        location: wh.code, items: [{ itemId: item.id, quantity: 5, unitPrice: 100_000, location: wh.code }],
      });
      const invoiceId = await DocumentService.createDocument({
        docType: 'invoice', status: 'final', inOut: 'out', date: today, user: 'td1241', buyerName: 'td1241 buyer',
        location: wh.code, items: [{ itemId: item.id, quantity: 1, unitPrice: 150_000, location: wh.code }],
      });
      const [voucher] = await orm.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber })
        .from(journalVouchers)
        .where(and(eq(journalVouchers.sourceDocumentId, invoiceId), eq(journalVouchers.isDeleted, 0)));
      if (!voucher) throw new Error(`invoice ${invoiceId} has no voucher`);
      // Test setup: an approved voucher is reversed on void (a draft is only soft-deleted)
      await orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.id, voucher.id));

      await DocumentService.deleteDocument(invoiceId, 'td1241');

      const [reversal] = await orm.select({ description: journalVouchers.description }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceNumber, `REV-V${voucher.voucherNumber}`), eq(journalVouchers.isDeleted, 0)));
      const description = String(reversal?.description ?? '');
      if (!reversal) throw new Error(`no reversal voucher for voucher ${voucher.voucherNumber}`);
      if (description.includes('invoice') || !description.includes(SALES_INVOICE_NAME)) {
        throw new Error(`reversal description must name the sales invoice in Persian without its type code: ${description.slice(0, 200)}`);
      }
      return `voucher ${voucher.voucherNumber} reversed with a Persian document type in its description`;
    }));
  }

  return results;
}
