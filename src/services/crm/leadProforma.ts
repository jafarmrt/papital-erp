import { and, asc, eq, or } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { crmActivities, crmLeads, documents } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { crmTodayActivityDates } from '../../lib/storageDate.js';

/**
 * پیوند پرونده فروش و پیش‌فاکتور آن («فروش موفق» فقط پس از پیش‌فاکتور، TD-309).
 */

type Lead = typeof crmLeads.$inferSelect;

/**
 * v9.0.13 (TD-424): پیش از ثبت پیش‌فاکتور پرونده، درون تراکنش سند، ردیف پرونده قفل و «یک پیش‌فاکتور برای هر پرونده» زیر
 * همان قفل سنجیده می‌شود. پیش‌تر بررسی بیرون از تراکنش و بی قفل بود و علامت‌گذاری پس از commit سند: سه پیش‌فاکتور هم‌زمان
 * با یک پرونده هر سه ثبت می‌شدند. پرونده حذف‌شده یا ناموجود `null` است (سند بی علامت‌گذاری پرونده ثبت می‌شود، مانند پیش).
 */
export async function lockLeadForNewProforma(tx: DbExecutor, leadId: number): Promise<Lead | null> {
  const [lead] = await tx.select().from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.isDeleted, 0)))
    .for('update');
  if (lead && lead.hasProforma === 1) {
    throw new ValidationError(`برای پرونده فروش «${lead.title}» قبلاً پیش‌فاکتور صادر شده است. هر پرونده فروش تنها مجاز به داشتن یک پیش‌فاکتور می‌باشد.`);
  }
  return lead ?? null;
}

/** v9.0.13 (TD-424): علامت پیش‌فاکتور پرونده در همان تراکنش سند، با شماره واقعی سند (نه «auto») */
export async function markLeadProforma(tx: DbExecutor, lead: Lead, docId: number, actorName: string): Promise<void> {
  const [doc] = await tx.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, docId));
  const ref = doc?.refNumber || String(docId);
  const nowIso = systemNowUtcIso();
  await tx.update(crmLeads).set({
    hasProforma: 1,
    proformaId: docId,
    stage: 'proposal',
    status: 'active',
    updatedAt: nowIso,
  }).where(eq(crmLeads.id, lead.id));
  await tx.insert(crmActivities).values({
    leadId: lead.id,
    customerId: lead.customerId,
    type: 'quote',
    title: `صدور پیش‌فاکتور شماره ${ref}`,
    description: `پیش‌فاکتور رسمی به شماره ${ref} در سیستم ثبت گردید.`,
    loggedBy: actorName,
    assignedTo: actorName,
    ...(await crmTodayActivityDates()),
    createdAt: nowIso,
    isDeleted: 0,
  });
}

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

/**
 * v9.0.323 (TD-776): پیوند پرونده فروش در ویرایش سند (`PUT /documents/:id` با `crmLeadId`). شناسه داده‌شده (عدد، یا `null` و
 * رشته خالی برای قطع پیوند)؛ `undefined` یعنی بدنه پیوند را تغییر نمی‌دهد.
 */
export function documentLeadLinkOf(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`شناسه پرونده فروش (crmLeadId) نامعتبر است: ${String(raw)}`, undefined, 'CRM_LEAD_INVALID');
  }
  return id;
}

export interface LockedDocumentLeads {
  /** پرونده‌ای که سند به آن وصل می‌شود (`null`: قطع پیوند) */
  target: Lead | null;
  /** پرونده‌هایی که اکنون این سند را پیش‌فاکتور خود می‌دانند */
  linked: Lead[];
}

/**
 * v9.0.323 (TD-776): پیش از قفل ردیف سند، درون تراکنش ویرایش، پرونده‌های وصل به این سند و پرونده مقصد به ترتیب صعودی شناسه
 * قفل می‌شوند (همان ترتیب ثبت و ابطال: پرونده پیش از سند). پرونده ناموجود یا حذف‌شده ۴۲۲ `CRM_LEAD_NOT_FOUND` پیش از هر
 * نوشتن؛ برای پیش‌فاکتور، پرونده‌ای که پیش‌فاکتور دیگری دارد ۴۲۲ (همان قاعده «یک پیش‌فاکتور برای هر پرونده»، TD-424).
 * پیش‌تر route پس از commit ویرایش، بی قفل و بی قاعده `crm_lead_id` را می‌نوشت: پرونده دو پیش‌فاکتور زنده می‌گرفت و پرونده
 * ناموجود پس از ثبت ویرایش ۴۰۹ می‌داد.
 */
export async function lockLeadsForDocumentLink(
  tx: DbExecutor,
  docId: number,
  targetId: number | null,
  isProforma: boolean,
): Promise<LockedDocumentLeads> {
  const linkedToDoc = and(eq(crmLeads.proformaId, docId), eq(crmLeads.hasProforma, 1));
  const rows = await tx.select().from(crmLeads)
    .where(and(eq(crmLeads.isDeleted, 0), targetId ? or(linkedToDoc, eq(crmLeads.id, targetId)) : linkedToDoc))
    .orderBy(asc(crmLeads.id))
    .for('update');
  const target = targetId ? rows.find(lead => lead.id === targetId) ?? null : null;
  if (targetId && !target) {
    throw new ValidationError(`پرونده فروش با شناسه ${targetId} یافت نشد یا حذف شده است.`, undefined, 'CRM_LEAD_NOT_FOUND');
  }
  if (target && isProforma && target.hasProforma === 1 && target.proformaId !== docId) {
    throw new ValidationError(`برای پرونده فروش «${target.title}» قبلاً پیش‌فاکتور صادر شده است. هر پرونده فروش تنها مجاز به داشتن یک پیش‌فاکتور می‌باشد.`, undefined, 'CRM_LEAD_HAS_PROFORMA');
  }
  return { target, linked: rows.filter(lead => lead.hasProforma === 1 && lead.proformaId === docId) };
}

/**
 * v9.0.323 (TD-776): پیوند قفل‌شده را در همان تراکنش ویرایش می‌نویسد: پرونده‌ای که دیگر به این سند وصل نیست آزاد می‌شود (با
 * یادداشت)، پیش‌فاکتوری که به پرونده تازه وصل می‌شود علامت پیش‌فاکتور آن پرونده را می‌گیرد، و `crm_lead_id` سند به‌روز می‌شود.
 */
export async function applyDocumentLeadLink(
  tx: DbExecutor,
  doc: { id: number; refNumber: string | null; isProforma: boolean },
  locked: LockedDocumentLeads,
  actorName: string,
): Promise<void> {
  const ref = doc.refNumber || String(doc.id);
  const nowIso = systemNowUtcIso();
  for (const lead of locked.linked) {
    if (lead.id === locked.target?.id) continue;
    await tx.update(crmLeads).set({ hasProforma: 0, proformaId: null, updatedAt: nowIso }).where(eq(crmLeads.id, lead.id));
    await tx.insert(crmActivities).values({
      leadId: lead.id,
      customerId: lead.customerId,
      type: 'note',
      title: 'برداشتن پیوند پیش‌فاکتور',
      description: `پیش‌فاکتور شماره "${ref}" دیگر به این پرونده وصل نیست؛ پرونده فروش برای صدور پیش‌فاکتور تازه باز شد.`,
      loggedBy: actorName,
      assignedTo: lead.assignedTo || '',
      ...(await crmTodayActivityDates()),
      createdAt: nowIso,
      isDeleted: 0,
    });
  }
  await tx.update(documents).set({ crmLeadId: locked.target?.id ?? null }).where(eq(documents.id, doc.id));
  if (locked.target && doc.isProforma && locked.target.proformaId !== doc.id) {
    await markLeadProforma(tx, locked.target, doc.id, actorName);
  }
}
