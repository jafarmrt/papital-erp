import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import { crmActivities, crmLeads, documents } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { crmTodayActivityDates } from '../../lib/storageDate.js';
import { toPersianDigits } from '../../utils.js';
import { logger } from '../../middleware/logger.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { recordLeadStageChange } from './crmLeadStageHistory.js';

type Lead = typeof crmLeads.$inferSelect;

/** «معامله موفق» goes to the holders of «مدیریت فرصت‌های فروش» (v9.0.127, TD-883) */
export const WON_LEAD_NOTIFY_PERMISSION = 'crm.manage';

/** The users who hold a permission, read in the given transaction; the caller passes `permissionHolderUserIdsWith` */
export type PermissionHolders = (tx: DbTransaction, permission: string) => Promise<number[]>;

/**
 * v11 phase 6.4 (C4): a lead's status follows its stage (`won` → `won`, `lost` → `lost`, any open stage → `active`);
 * only `archived` is a status of its own. A status sent alone moves the stage the same way (`lost` asks its reason and
 * writes the stage history like the stage path), and a stage and status that disagree are refused. Before, `{status:'lost'}`
 * left the stage at «مخاطب اولیه» with no reason and no history row, so stats, the funnel and the proforma rule each gave
 * a different answer.
 */
export function statusOfStage(stage: string): 'won' | 'lost' | 'active' {
  return stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : 'active';
}

export interface LeadStageStatusInput {
  requestedStage?: string;
  requestedStatus?: string;
  existingStage: string | null;
  existingStatus: string | null;
}

/** The stage to write (`undefined`: unchanged) and the status that goes with it */
export function resolveLeadStageStatus(input: LeadStageStatusInput): { stage: string | undefined; status: string } {
  const { requestedStage, requestedStatus } = input;
  const existingStage = input.existingStage || 'lead';
  if (requestedStage !== undefined) {
    if (requestedStatus !== undefined && requestedStatus !== 'archived' && requestedStatus !== statusOfStage(requestedStage)) {
      throw new ValidationError('وضعیت و مرحلهٔ پرونده فروش با هم نمی‌خوانند؛ فقط مرحله را بفرستید.', { stage: requestedStage, status: requestedStatus }, 'CRM_LEAD_STATUS_STAGE_MISMATCH');
    }
    return { stage: requestedStage, status: requestedStatus === 'archived' ? 'archived' : statusOfStage(requestedStage) };
  }
  if (requestedStatus === 'won' || requestedStatus === 'lost') {
    return { stage: requestedStatus === existingStage ? undefined : requestedStatus, status: requestedStatus };
  }
  if (requestedStatus === 'active') {
    if (existingStage === 'won' || existingStage === 'lost') {
      throw new ValidationError('برای باز کردن دوبارهٔ پرونده بسته، مرحلهٔ تازهٔ آن را انتخاب کنید.', { stage: existingStage }, 'CRM_LEAD_STATUS_STAGE_MISMATCH');
    }
    return { stage: undefined, status: 'active' };
  }
  if (requestedStatus === 'archived') return { stage: undefined, status: 'archived' };
  return { stage: undefined, status: input.existingStatus || statusOfStage(existingStage) };
}

/** v11 phase 6.4 (C6): sort key of the unpaged lead list: open files (status `active`) before closed and archived ones */
export const openLeadsFirst = sql`(CASE WHEN coalesce(${crmLeads.status}, 'active') = 'active' THEN 0 ELSE 1 END)`;

/** The final invoice a lead's proforma became, or null (no proforma, voided, or not final yet) */
export async function leadFinalInvoice(executor: DbExecutor, lead: Pick<Lead, 'hasProforma' | 'proformaId'>): Promise<{ id: number; refNumber: string } | null> {
  if (Number(lead.hasProforma) !== 1 || !lead.proformaId) return null;
  const [doc] = await executor.select({ id: documents.id, refNumber: documents.refNumber }).from(documents)
    .where(and(eq(documents.id, lead.proformaId), eq(documents.isDeleted, 0), eq(documents.status, 'final')));
  return doc ? { id: doc.id, refNumber: doc.refNumber || String(doc.id) } : null;
}

/**
 * v11 phase 6.4 (C3): a lead whose proforma became a final invoice is a sale; it stays «فروش موفق» until that invoice is
 * voided (`releaseLeadOfVoidedDocument` moves it back). Before, such a lead could be saved as «از دست رفته» with a reason
 * such as price, so the funnel counted a real sale as lost.
 */
export async function assertSoldLeadStaysWon(executor: DbExecutor, lead: Lead, targetStage: string): Promise<void> {
  if (targetStage === 'won') return;
  const invoice = await leadFinalInvoice(executor, lead);
  if (!invoice) return;
  throw new ValidationError(
    `پیش‌فاکتور این پرونده به فاکتور قطعی شمارهٔ ${toPersianDigits(invoice.refNumber)} تبدیل شده است؛ پرونده فقط به «فروش موفق» می‌رود. برای مرحلهٔ دیگر، نخست آن فاکتور را باطل کنید.`,
    { leadId: lead.id, documentId: invoice.id },
    'CRM_LEAD_SOLD',
  );
}

/**
 * v11 phase 6.4 (C3): the lead whose proforma is this document, locked before the items and the document (the same order
 * as the void: lead → items → project → document). Null when no live lead links it.
 */
export async function lockLeadOfSalesDocument(tx: DbExecutor, docId: number): Promise<Lead | null> {
  const [lead] = await tx.select().from(crmLeads)
    .where(and(eq(crmLeads.proformaId, docId), eq(crmLeads.hasProforma, 1), eq(crmLeads.isDeleted, 0)))
    .orderBy(asc(crmLeads.id))
    .for('update');
  return lead ?? null;
}

/**
 * v11 phase 6.4 (C3): when the lead's proforma becomes a final invoice, the lead moves to «فروش موفق» in the same
 * transaction, with its stage history row, an activity note and the «معامله موفق» notice. A lead already won is left as
 * it is. A lead saved as lost moves to won too: the invoice is the sale, and its lost reason is cleared. Returns true when
 * the lead moved.
 */
export async function markLeadWonByInvoice(
  tx: DbTransaction,
  lead: Lead,
  invoice: { refNumber: string | null; id: number },
  actor: { id?: number | null; name: string },
  holders: PermissionHolders,
): Promise<boolean> {
  if (lead.stage === 'won' && lead.status === 'won') return false;
  const nowIso = systemNowUtcIso();
  await tx.update(crmLeads).set({
    stage: 'won',
    status: 'won',
    lostReason: '',
    lostReasonNote: '',
    updatedAt: nowIso,
  }).where(eq(crmLeads.id, lead.id));
  await recordLeadStageChange(tx, {
    leadId: lead.id, fromStage: lead.stage, toStage: 'won', assignedPersonnelId: lead.assignedPersonnelId, actor,
  });
  const ref = toPersianDigits(invoice.refNumber || String(invoice.id));
  await tx.insert(crmActivities).values({
    leadId: lead.id,
    customerId: lead.customerId,
    type: 'note',
    title: 'فروش موفق با فاکتور قطعی',
    description: `پیش‌فاکتور پرونده به فاکتور قطعی شمارهٔ ${ref} تبدیل شد و پرونده به «فروش موفق» رفت.`,
    loggedBy: actor.name,
    assignedTo: lead.assignedTo || '',
    ...(await crmTodayActivityDates()),
    createdAt: nowIso,
    isDeleted: 0,
  });
  // the notice is not worth the sale: a failed write rolls back to its savepoint and the finalize goes on
  try {
    await tx.transaction(sp => notifyLeadWon(sp, lead, actor, holders));
  } catch (err) {
    logger.error({ message: 'Error notifying the won lead of a final invoice', leadId: lead.id, error: err });
  }
  return true;
}

/** «معامله موفق جدید» in the bell of the holders of `crm.manage`, except the user who made it */
export async function notifyLeadWon(tx: DbTransaction, lead: Pick<Lead, 'id' | 'title'>, actor: { id?: number | null; name: string }, holders: PermissionHolders): Promise<void> {
  const recipients = (await holders(tx, WON_LEAD_NOTIFY_PERMISSION)).filter(userId => !(actor.id && userId === actor.id));
  await createNotifications(tx, recipients.map(userId => ({
    userId,
    category: 'crm_won' as const,
    senderId: actor.id || null,
    senderName: actor.name,
    type: 'system',
    title: `🎉 معامله موفق جدید: ${lead.title}`,
    message: 'پرونده فروش با موفقیت نهایی شد.',
    link: `/crm?leadId=${lead.id}`,
  })));
}
