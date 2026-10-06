import { and, eq, or } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { crmLeads, documents } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';

type Lead = typeof crmLeads.$inferSelect;

/**
 * v9.0.16 (TD-425): حذف پرونده فروش زیر قفل ردیف پرونده (همان ترتیب قفل صدور و ابطال پیش‌فاکتور: پرونده اول).
 * پرونده ناموجود یا حذف‌شده ۴۰۴ است و پرونده‌ای که سند فعال (پیش‌فاکتور یا فاکتور نهایی‌شده از آن) دارد با ۴۰۹ رد می‌شود؛
 * اقدام‌ها و پیگیری‌های پرونده حذف‌شده با `liveLeadActivityCondition` از آمار، فهرست‌ها و یادآور سررسید بیرون می‌روند.
 * پیش‌تر حذف بی بررسی بود: شناسه ناموجود ۲۰۰ و لاگ «حذف» می‌گرفت و پیگیری پرونده حذف‌شده در آمار و یادآور می‌ماند.
 */
export async function deleteLead(tx: DbExecutor, id: number): Promise<Lead> {
  const [lead] = await tx.select().from(crmLeads)
    .where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0)))
    .for('update');
  if (!lead) throw new NotFoundError('پرونده فروش یافت نشد');

  const linkedToLead = lead.proformaId ? or(eq(documents.crmLeadId, id), eq(documents.id, lead.proformaId)) : eq(documents.crmLeadId, id);
  const linked = await tx.select({ id: documents.id, refNumber: documents.refNumber })
    .from(documents)
    .where(and(eq(documents.isDeleted, 0), linkedToLead))
    .orderBy(documents.id);
  if (linked.length > 0) {
    const refs = linked.map(d => `«${d.refNumber || d.id}»`).join('، ');
    throw new ConflictError(`پرونده فروش «${lead.title}» سند فعال ${refs} دارد و حذف نمی‌شود؛ ابتدا سند را باطل کنید.`);
  }

  await tx.update(crmLeads).set({ isDeleted: 1, updatedAt: systemNowUtcIso() }).where(eq(crmLeads.id, id));
  return lead;
}
