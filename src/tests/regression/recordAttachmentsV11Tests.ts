import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, fiscalPeriods, journalVouchers } from '../../db/schema.js';
import { businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { FiscalPeriodService } from '../../services/accounting/fiscalPeriod.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * v11 «افزودن پیوست» (owner's decision 7 Aban 1405): a file is added to and removed from a recorded voucher outside its
 * form while it is a draft; once approved a file is only added; in a closed fiscal year nothing changes; a reader sees
 * the files but does not change them; every change is audited. Real Express routes on PostgreSQL, in its own schema. Red
 * before this change: the routes did not exist.
 */

type Res = { status: number; body?: unknown };
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const filesOf = (res: Res) => ((res.body as { attachments?: Array<{ id: string; name: string; uploadedBy?: string; uploadedAt?: string }> } | undefined)?.attachments ?? []);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function draftVoucher(date: string, description: string): Promise<number> {
  const ids = await accountIdsByCode('1201', '5001');
  const v = await VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'draft', description, referenceModule: 'manual',
    items: [
      { accountId: ids['1201'], debit: 1000, credit: 0, description },
      { accountId: ids['5001'], debit: 0, credit: 1000, description },
    ],
  });
  return v.id;
}

export async function runRecordAttachmentsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_record_attachments_v11';
  if (shouldRun(id, 'v11', 'attachments', 'voucher', 'fiscal')) {
    await runCase(results, id, 'v11 add attachment: a draft voucher takes a file and gives it back; an approved one only takes files (409 RECORD_ATTACHMENT_APPROVED on removal); a voucher of a closed year takes nothing (409 RECORD_ATTACHMENT_YEAR_CLOSED); a reader sees the files but is refused a change (403); a deleted voucher is 404; each change is audited with its user', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const reader = await sandboxClientWith(['accounting.view']);
      const today = await businessTodayIsoDate();
      const voucherId = await draftVoucher(today, 'record attachments');
      const URL = `/api/record-attachments/journal_voucher/${voucherId}`;

      const added = await admin.post(URL, { name: 'invoice.png', dataUrl: PNG });
      const first = filesOf(added)[0];
      if (added.status !== 200 || filesOf(added).length !== 1 || !first?.uploadedAt || !first?.uploadedBy) problems.push(`adding to a draft answered ${brief(added)}, expected one file with its time and user`);
      // the voucher's version moves, so its form opened before the change cannot save the old list back
      const [afterAdd] = await orm.select({ version: journalVouchers.version }).from(journalVouchers).where(eq(journalVouchers.id, voucherId));
      if (afterAdd?.version !== 2) problems.push(`the voucher's version after a window change is ${afterAdd?.version}, expected 2`);
      const removed = await admin.del(`${URL}/${first?.id}`);
      if (removed.status !== 200 || filesOf(removed).length !== 0) problems.push(`removing from a draft answered ${brief(removed)}, expected none left`);

      const kept = await admin.post(URL, { name: 'receipt.png', dataUrl: PNG });
      await orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.id, voucherId));
      const listed = await reader.get(URL);
      const listedBody = listed.body as { approved?: unknown; yearClosed?: unknown } | undefined;
      if (listed.status !== 200 || filesOf(listed).length !== 1 || listedBody?.approved !== true || listedBody?.yearClosed !== false) problems.push(`a reader listing the approved voucher read ${brief(listed)}, expected one file, approved, year open`);
      const byReader = await reader.post(URL, { name: 'x.png', dataUrl: PNG });
      if (byReader.status !== 403) problems.push(`a reader adding answered ${brief(byReader)}, expected 403`);
      const removeApproved = await admin.del(`${URL}/${filesOf(kept)[0]?.id}`);
      if (removeApproved.status !== 409 || codeOf(removeApproved) !== 'RECORD_ATTACHMENT_APPROVED') problems.push(`removing from an approved voucher answered ${brief(removeApproved)}, expected 409 RECORD_ATTACHMENT_APPROVED`);
      const addApproved = await admin.post(URL, { name: 'later.png', dataUrl: PNG });
      if (addApproved.status !== 200 || filesOf(addApproved).length !== 2) problems.push(`adding to an approved voucher answered ${brief(addApproved)}, expected two files`);

      // a voucher of a year closed after it was recorded
      const oldDate = '2024-06-01';
      const oldId = await draftVoucher(oldDate, 'closed year');
      await orm.insert(fiscalPeriods).values({ fiscalYear: resolveJalaliFiscalYear(oldDate), status: 'closed', closedBy: 'reg' })
        .onConflictDoUpdate({ target: fiscalPeriods.fiscalYear, set: { status: 'closed', closedBy: 'reg' } });
      FiscalPeriodService.resetCache();
      const closed = await admin.post(`/api/record-attachments/journal_voucher/${oldId}`, { name: 'old.png', dataUrl: PNG });
      if (closed.status !== 409 || codeOf(closed) !== 'RECORD_ATTACHMENT_YEAR_CLOSED') problems.push(`adding in a closed year answered ${brief(closed)}, expected 409 RECORD_ATTACHMENT_YEAR_CLOSED`);

      await orm.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, voucherId));
      const gone = await admin.post(URL, { name: 'gone.png', dataUrl: PNG });
      if (gone.status !== 404) problems.push(`adding to a deleted voucher answered ${brief(gone)}, expected 404`);

      const audits = await orm.execute(`SELECT count(*)::int AS n FROM activity_logs WHERE entity = 'journal_voucher' AND entity_id = '${voucherId}' AND details->>'source' = 'record_attachments'`);
      if (Number((audits.rows[0] as { n: number }).n) !== 4) problems.push(`the changes wrote ${(audits.rows[0] as { n: number }).n} audit rows, expected 4`);

      assertNoProblems(problems);
      return 'a draft took and gave back a file; an approved voucher only took files; a closed year and a reader were refused; a deleted voucher was 404; four audit rows';
    }));
  }

  const docId = 'reg_record_attachments_documents_v11';
  if (shouldRun(docId, 'v11', 'attachments', 'documents')) {
    await runCase(results, docId, 'v11 add attachment on documents: a receipt clerk is refused a change on a sales invoice (403) while the sales clerk adds; a final transfer, which never gets a voucher, counts as approved (removal 409 RECORD_ATTACHMENT_APPROVED)', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const receiptClerk = await sandboxClientWith(['documents.view', 'warehouse.in']);
      const salesClerk = await sandboxClientWith(['documents.view', 'documents.create']);
      const today = await businessTodayIsoDate();
      const [invoice] = await orm.insert(documents).values({ type: 'invoice', refNumber: `RA-INV-${Date.now()}`, date: `${today} 00:00:00`, status: 'draft' }).returning({ id: documents.id });
      const [transfer] = await orm.insert(documents).values({ type: 'transfer', refNumber: `RA-TR-${Date.now()}`, date: `${today} 00:00:00`, status: 'final' }).returning({ id: documents.id });

      const byReceiptClerk = await receiptClerk.post(`/api/record-attachments/document/${invoice.id}`, { name: 'x.png', dataUrl: PNG });
      if (byReceiptClerk.status !== 403) problems.push(`a receipt clerk adding to a sales invoice answered ${brief(byReceiptClerk)}, expected 403`);
      const bySalesClerk = await salesClerk.post(`/api/record-attachments/document/${invoice.id}`, { name: 'x.png', dataUrl: PNG });
      if (bySalesClerk.status !== 200) problems.push(`a sales clerk adding to a draft sales invoice answered ${brief(bySalesClerk)}, expected 200`);

      const onTransfer = await admin.post(`/api/record-attachments/document/${transfer.id}`, { name: 't.png', dataUrl: PNG });
      if (onTransfer.status !== 200) problems.push(`adding to a final transfer answered ${brief(onTransfer)}, expected 200`);
      const offTransfer = await admin.del(`/api/record-attachments/document/${transfer.id}/${filesOf(onTransfer)[0]?.id}`);
      if (offTransfer.status !== 409 || codeOf(offTransfer) !== 'RECORD_ATTACHMENT_APPROVED') problems.push(`removing from a final transfer answered ${brief(offTransfer)}, expected 409 RECORD_ATTACHMENT_APPROVED`);

      assertNoProblems(problems);
      return 'the receipt clerk was refused on a sales invoice, the sales clerk added; a final transfer kept its file';
    }));
  }

  return results;
}
