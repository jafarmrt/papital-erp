import { and, eq, or } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { cheques, documents, journalVouchers, treasuryTransactions } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import {
  RECORD_ATTACHMENT_APPROVED,
  RECORD_ATTACHMENT_YEAR_CLOSED,
  recordAttachmentRefusal,
  type RecordAttachmentEntity,
  type RecordAttachmentState,
} from '../../lib/attachments/recordAttachments.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';
import type { FinancialAttachment } from '../../types/accounting.types.js';
import { FiscalPeriodService } from '../accounting/fiscalPeriod.service.js';
import { AttachmentStorageService } from './attachmentStorage.service.js';

/**
 * v11 «افزودن پیوست» (owner's decision 7 Aban 1405; rule in `src/lib/attachments/recordAttachments.ts`): the files of a
 * recorded document, treasury row, cheque or voucher, added and removed one at a time outside the record's own form. A
 * record is approved when its voucher (a voucher: itself) is past draft: then a file is only added. Its fiscal year is the
 * year of its date (a cheque: its issue day); once closed nothing changes. The write locks the record row and reads the
 * year with the closing lock, so it cannot race a close. Each change goes through the attachment service, like a file of
 * the record's own form, and writes an audit row on the record.
 */

const ENTITY_AUDIT_NAME: Record<RecordAttachmentEntity, string> = {
  document: 'اسناد انبار',
  treasury_transaction: 'treasury_transaction',
  cheque: 'cheque',
  journal_voucher: 'journal_voucher',
};

const ENTITY_TITLE: Record<RecordAttachmentEntity, string> = {
  document: 'سند',
  treasury_transaction: 'تراکنش خزانه',
  cheque: 'چک',
  journal_voucher: 'سند حسابداری',
};

interface RecordRow {
  attachments: FinancialAttachment[];
  date: string;
  /** a voucher's own status, or the statuses of the record's live vouchers */
  voucherStatuses: string[];
  label: string;
}

const listOf = (value: unknown): FinancialAttachment[] => (Array.isArray(value) ? value as FinancialAttachment[] : []);

async function liveVoucherStatuses(tx: DbExecutor, where: ReturnType<typeof and>): Promise<string[]> {
  const rows = await tx.select({ status: journalVouchers.status }).from(journalVouchers).where(and(eq(journalVouchers.isDeleted, 0), where));
  return rows.map(r => String(r.status ?? 'draft'));
}

/** The record's files, date and approval, locked FOR UPDATE when `lock` (a change), else read. */
async function readRecord(tx: DbExecutor, entity: RecordAttachmentEntity, id: number, lock: boolean): Promise<RecordRow | null> {
  if (entity === 'journal_voucher') {
    const q = tx.select({ attachments: journalVouchers.attachments, date: journalVouchers.date, status: journalVouchers.status, no: journalVouchers.voucherNumber })
      .from(journalVouchers).where(and(eq(journalVouchers.id, id), eq(journalVouchers.isDeleted, 0)));
    const [row] = lock ? await q.for('update') : await q;
    return row ? { attachments: listOf(row.attachments), date: row.date, voucherStatuses: [String(row.status ?? 'draft')], label: `سند حسابداری ${row.no}` } : null;
  }
  if (entity === 'treasury_transaction') {
    const q = tx.select({ attachments: treasuryTransactions.attachments, date: treasuryTransactions.date, voucherId: treasuryTransactions.voucherId, no: treasuryTransactions.transactionNumber })
      .from(treasuryTransactions).where(and(eq(treasuryTransactions.id, id), eq(treasuryTransactions.isDeleted, 0)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) return null;
    const statuses = row.voucherId ? await liveVoucherStatuses(tx, eq(journalVouchers.id, row.voucherId)) : [];
    return { attachments: listOf(row.attachments), date: row.date, voucherStatuses: statuses, label: `تراکنش ${row.no}` };
  }
  if (entity === 'cheque') {
    const q = tx.select({ attachments: cheques.attachments, date: cheques.issueDate, voucherId: cheques.voucherId, no: cheques.chequeNumber })
      .from(cheques).where(and(eq(cheques.id, id), eq(cheques.isDeleted, 0)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) return null;
    const statuses = await liveVoucherStatuses(tx, row.voucherId
      ? or(eq(journalVouchers.sourceChequeId, id), eq(journalVouchers.id, row.voucherId))
      : eq(journalVouchers.sourceChequeId, id));
    return { attachments: listOf(row.attachments), date: row.date, voucherStatuses: statuses, label: `چک ${row.no}` };
  }
  const q = tx.select({ attachments: documents.attachments, date: documents.date, no: documents.refNumber })
    .from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) return null;
  const statuses = await liveVoucherStatuses(tx, eq(journalVouchers.sourceDocumentId, id));
  return { attachments: listOf(row.attachments), date: String(row.date ?? '').slice(0, 10), voucherStatuses: statuses, label: `سند ${row.no ?? id}` };
}

const isApproved = (row: RecordRow) => row.voucherStatuses.some(s => s !== 'draft' && s !== 'voided');

async function stateOf(tx: DbExecutor, row: RecordRow, shared: boolean): Promise<RecordAttachmentState> {
  const yearClosed = shared ? await FiscalPeriodService.isClosedShared(row.date, tx) : await FiscalPeriodService.isClosed(row.date, tx);
  return { attachments: row.attachments, approved: isApproved(row), yearClosed };
}

function notFound(entity: RecordAttachmentEntity): NotFoundError {
  return new NotFoundError(`${ENTITY_TITLE[entity]} یافت نشد یا حذف شده است.`, undefined, 'RECORD_ATTACHMENT_NOT_FOUND');
}

export interface RecordAttachmentActor {
  userId?: number;
  username?: string;
  userFullName?: string;
  req?: unknown;
}

/** The record's files and whether it is approved or its year closed (what the window offers). */
export async function recordAttachments(entity: RecordAttachmentEntity, id: number): Promise<RecordAttachmentState> {
  const row = await readRecord(orm, entity, id, false);
  if (!row) throw notFound(entity);
  return stateOf(orm, row, false);
}

function refuse(state: RecordAttachmentState, action: 'add' | 'remove'): void {
  const refusal = recordAttachmentRefusal(state, action);
  if (refusal) throw new ConflictError(refusal, undefined, state.yearClosed ? RECORD_ATTACHMENT_YEAR_CLOSED : RECORD_ATTACHMENT_APPROVED);
}

async function audit(tx: DbExecutor, entity: RecordAttachmentEntity, id: number, actor: RecordAttachmentActor, description: string, details: Record<string, unknown>) {
  await logActivity({
    tx,
    req: actor.req,
    userId: actor.userId,
    username: actor.username,
    userFullName: actor.userFullName,
    action: 'UPDATE',
    entity: ENTITY_AUDIT_NAME[entity],
    entityId: String(id),
    description,
    details: { ...details, source: 'record_attachments' },
  });
}

/** Adds one file (a data URL) to the record; kept with its name, time and user. */
export async function addRecordAttachment(
  entity: RecordAttachmentEntity, id: number, file: { name: string; dataUrl: string }, actor: RecordAttachmentActor,
): Promise<RecordAttachmentState> {
  const name = file.name.trim();
  if (!name) throw new ValidationError('نام فایل پیوست خالی است.', undefined, 'RECORD_ATTACHMENT_NAME');
  return idempotentTransaction(async (tx: DbExecutor) => {
    const row = await readRecord(tx, entity, id, true);
    if (!row) throw notFound(entity);
    const state = await stateOf(tx, row, true);
    refuse(state, 'add');
    const actorName = actor.userFullName || actor.username || '';
    const stored = await AttachmentStorageService.replaceRecordAttachments(tx, entity, id, [...row.attachments, { name, url: file.dataUrl }], actorName);
    await audit(tx, entity, id, actor, `افزودن پیوست «${name}» به ${row.label}`, { attachment: name, approved: state.approved });
    return { ...state, attachments: stored };
  });
}

/** Removes one file of a record not yet approved. */
export async function removeRecordAttachment(
  entity: RecordAttachmentEntity, id: number, attachmentId: string, actor: RecordAttachmentActor,
): Promise<RecordAttachmentState> {
  return idempotentTransaction(async (tx: DbExecutor) => {
    const row = await readRecord(tx, entity, id, true);
    if (!row) throw notFound(entity);
    const state = await stateOf(tx, row, true);
    refuse(state, 'remove');
    const target = row.attachments.find(a => String(a?.id ?? '') === attachmentId);
    if (!target) throw new NotFoundError('این پیوست روی این سند نیست.', undefined, 'RECORD_ATTACHMENT_NOT_FOUND');
    const actorName = actor.userFullName || actor.username || '';
    const stored = await AttachmentStorageService.replaceRecordAttachments(tx, entity, id, row.attachments.filter(a => a !== target), actorName);
    await audit(tx, entity, id, actor, `برداشتن پیوست «${target.name}» از ${row.label}`, { attachment: target.name });
    return { ...state, attachments: stored };
  });
}

