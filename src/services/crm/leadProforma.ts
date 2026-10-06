import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { crmActivities, crmLeads } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { crmTodayActivityDates } from '../../lib/storageDate.js';

/**
 * پیوند پرونده فروش و پیش‌فاکتور آن («فروش موفق» فقط پس از پیش‌فاکتور، TD-309).
 */

export interface ReleasedLead {
  leadId: number;
  /** پرونده «فروش موفق» بود و به «پیش‌فاکتور و پیشنهاد» برگشت */
  reopenedFromWon: boolean;
}

/**
 * v9.0.12 (TD-423): ابطال سندی که پرونده به آن اشاره می‌کند (پیش‌فاکتور، یا فاکتوری که از همان پیش‌فاکتور نهایی شده) پرونده
 * را برای پیش‌فاکتور تازه باز می‌کند و پرونده «فروش موفق» را به «پیش‌فاکتور و پیشنهاد» برمی‌گرداند. درون تراکنش ابطال سند
 * و پیش از قفل کالاها و سند صدا زده می‌شود (پرونده ← کالاها ← پروژه ← سند)؛ اگر ابطال رد شود، پرونده هم دست نمی‌خورد.
 * پیش‌تر فقط `has_proforma` پیش‌فاکتور، بیرون از تراکنش ابطال، پاک می‌شد و پرونده `won` بی سند پشتش «موفق» می‌ماند.
 */
export async function releaseLeadOfVoidedDocument(
  tx: DbExecutor,
  doc: { id: number; refNumber: string | null },
  actorName: string,
): Promise<ReleasedLead | null> {
  const [lead] = await tx.select().from(crmLeads)
    .where(and(eq(crmLeads.proformaId, doc.id), eq(crmLeads.hasProforma, 1), eq(crmLeads.isDeleted, 0)))
    .for('update');
  if (!lead) return null;

  const reopenedFromWon = lead.stage === 'won' || lead.status === 'won';
  const nowIso = systemNowUtcIso();
  await tx.update(crmLeads).set({
    hasProforma: 0,
    proformaId: null,
    ...(reopenedFromWon ? { stage: 'proposal', status: 'active' } : {}),
    updatedAt: nowIso,
  }).where(eq(crmLeads.id, lead.id));

  const ref = doc.refNumber || String(doc.id);
  await tx.insert(crmActivities).values({
    leadId: lead.id,
    customerId: lead.customerId,
    type: 'note',
    title: 'ابطال پیش‌فاکتور',
    description: reopenedFromWon
      ? `سند شماره "${ref}" پرونده باطل شد؛ پرونده از «موفق (بسته شد)» به «پیش‌فاکتور و پیشنهاد» برگشت و برای صدور دوباره پیش‌فاکتور باز شد.`
      : `پیش‌فاکتور شماره "${ref}" باطل شد؛ پرونده فروش برای صدور دوباره پیش‌فاکتور باز شد.`,
    loggedBy: actorName,
    assignedTo: lead.assignedTo || '',
    ...(await crmTodayActivityDates()),
    createdAt: nowIso,
    isDeleted: 0,
  });
  return { leadId: lead.id, reopenedFromWon };
}
