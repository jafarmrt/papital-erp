import type { Request } from 'express';
import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor, type DbTransaction } from '../../db/drizzle.js';
import { notifications, storefrontForms, storefrontMessages } from '../../db/schema.js';
import { AppError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import {
  MESSAGES_HOURLY_CAP, MESSAGES_PAGE_SIZE, MESSAGE_REQUEST_KEY, MESSAGE_STATUSES, MESSAGE_STATUS_TITLES, checkedAnswers, firstAnswer, messagePreview, messagesWarnAt,
  type MessageAnswer, type MessageStatus,
} from '../../lib/storefront/storefrontMessageRules.js';
import type { FormSubmitAnswer, FormSubmitRequest, MessageDetail, MessageList, MessageListRow } from '../../lib/storefront/storefrontMessageContracts.js';
import { logger } from '../../middleware/logger.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { permissionHolderUserIdsWith } from '../notifications/notificationRecipients.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { openSiteLead } from './storefrontInquiry.service.js';
import { requestHashOf } from './storefrontOrderKeys.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 10f (package 18, V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «پیام‌های سایت». A visitor's answers to a form that
 * is on the site are checked against the form as it is now and kept as a message (a copy of each answer with its
 * field's name); the holders of `site_messages.view` get a bell that says only that a message came (never a name or a
 * word of it), and a form whose «پروندهٔ فروش هم بساز» is on also opens a sales lead. The site as a whole sends at most
 * `MESSAGES_HOURLY_CAP` messages an hour. Reading the messages needs `site_messages.view`; setting a status and
 * removing one need `site_messages.manage`, under the message's version, each with its audit row. The audit log never
 * holds what a visitor wrote.
 */
type MessageRecord = typeof storefrontMessages.$inferSelect;

const AUDIT_ENTITY = 'پیام سایت';
export const MESSAGES_VIEW_PERMISSION = 'site_messages.view';
const BUSY_TITLE = 'پیام‌های فرم‌های سایت به سقف ساعتی نزدیک است';
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');
const notFound = () => new NotFoundError('این پیام پیدا نشد.', undefined, 'STOREFRONT_MESSAGE_NOT_FOUND');

/** The site sent as many messages this hour as it may: the visitor is asked to try later (429) */
class MessagesBusyError extends AppError {
  constructor() {
    super('اکنون پیام‌های زیادی رسیده است؛ لطفاً کمی بعد دوباره بفرستید یا با ما تماس بگیرید.', 429, 'STOREFRONT_MESSAGES_BUSY');
  }
}

const sentThisHour = async (executor: DbExecutor): Promise<number> => {
  const [{ count }] = await executor.select({ count: sql<number>`count(*)::int` }).from(storefrontMessages).where(gt(storefrontMessages.createdAt, sql`now() - interval '1 hour'`));
  return count;
};

/** One bell for a new message; it says that a message came and nothing of it (AGENTS.md §3.11) */
async function notifyMessage(tx: DbTransaction, messageId: number): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      const recipients = await permissionHolderUserIdsWith(sp, MESSAGES_VIEW_PERMISSION);
      await createNotifications(sp, recipients.map(userId => ({
        userId, category: 'site_message' as const, type: 'system', senderName: STOREFRONT_BOT_USER,
        title: 'پیام تازه از فرم سایت', message: 'بازدیدکننده‌ای یکی از فرم‌های سایت را فرستاده است؛ آن را در «پیام‌های سایت» ببینید.',
        link: `/site-messages?message=${messageId}`,
      })));
    });
  } catch (err) {
    logger.error({ message: 'Error notifying colleagues of a site message', messageId, error: err });
  }
}

/** Once the hour reaches the warning share of the cap: one bell an hour, as for the site's texts */
async function warnIfNearlyFull(tx: DbTransaction): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      if (await sentThisHour(sp) < messagesWarnAt(MESSAGES_HOURLY_CAP)) return;
      const [rang] = await sp.select({ id: notifications.id }).from(notifications)
        .where(and(eq(notifications.senderName, STOREFRONT_BOT_USER), eq(notifications.title, BUSY_TITLE), gt(notifications.createdAt, sql`now() - interval '1 hour'`))).limit(1);
      if (rang) return;
      const recipients = await permissionHolderUserIdsWith(sp, MESSAGES_VIEW_PERMISSION);
      await createNotifications(sp, recipients.map(userId => ({
        userId, category: 'site_message' as const, type: 'system', senderName: STOREFRONT_BOT_USER, title: BUSY_TITLE,
        message: `دست‌کم ${messagesWarnAt(MESSAGES_HOURLY_CAP).toLocaleString('fa-IR')} پیام از سقف ${MESSAGES_HOURLY_CAP.toLocaleString('fa-IR')} در این ساعت رسیده است. اگر پیام‌ها واقعی نیستند، فرم را از روی سایت بردارید.`,
        link: '/site-messages',
      })));
    });
  } catch (err) {
    logger.error({ message: 'Error warning colleagues of the site messages cap', error: err });
  }
}

const answerOf = (row: MessageRecord): FormSubmitAnswer => ({ reference: String(row.id) });
const isRequestKeyViolation = (err: unknown): boolean => {
  const pg = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const e = pg?.code ? pg : pg?.cause;
  return e?.code === '23505' && e?.constraint === 'uq_storefront_messages_request_key';
};
async function replay(requestKey: string, requestHash: string): Promise<FormSubmitAnswer | null> {
  const [existing] = await orm.select().from(storefrontMessages).where(eq(storefrontMessages.requestKey, requestKey));
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new ValidationError('این شناسهٔ درخواست پیش‌تر برای پیام دیگری به کار رفته است.', undefined, 'STOREFRONT_REQUEST_KEY_REUSED');
  return answerOf(existing);
}

/** The lines a sales lead opened by a message carries: every written answer under its field's name */
const leadNotes = (formTitle: string, answers: readonly MessageAnswer[]): string => [
  `پیام فرم «${formTitle}» از سایت.`,
  ...answers.filter(answer => answer.kind !== 'consent' && answer.value !== '').map(answer => `${answer.label}: ${answer.value.replace(/\n/g, '، ')}`),
].join('\n');

/** `POST /api/storefront/v1/forms/:key/submit`: a visitor's answers to a form that is on the site */
export async function submitFormAnswers(key: string, input: FormSubmitRequest): Promise<FormSubmitAnswer> {
  const settings = await storefrontSettingValues(orm);
  if (!settings.enabled) throw new NotFoundError('پیدا نشد');
  const requestKey = String(input.requestKey ?? '').trim();
  if (!MESSAGE_REQUEST_KEY.test(requestKey)) throw new ValidationError('شناسهٔ درخواست نامعتبر است.', { field: 'requestKey' }, 'STOREFRONT_MESSAGE_FIELD_INVALID');
  const formGone = () => new NotFoundError('این فرم پیدا نشد.', undefined, 'STOREFRONT_FORM_NOT_FOUND');
  const [form] = await orm.select().from(storefrontForms).where(and(eq(storefrontForms.key, key), eq(storefrontForms.isDeleted, 0), eq(storefrontForms.enabled, 1)));
  if (!form) throw formGone();
  const checked = checkedAnswers({ fields: Array.isArray(form.fields) ? form.fields : [] }, input.answers);
  if (checked.problem) throw new ValidationError(checked.problem.message, { field: checked.problem.fieldId }, checked.problem.code);
  const answers = checked.answers;
  // the form is part of the request: the same key for another form, or other answers, is another request
  const requestHash = requestHashOf({ formId: form.id, answers });
  const before = await replay(requestKey, requestHash);
  if (before) return before;
  try {
    return await orm.transaction(async (tx) => {
      // the form as it is at this moment: taken off the site or removed between the read and here, it takes no answer
      const [live] = await tx.select({ id: storefrontForms.id, title: storefrontForms.title, makesLead: storefrontForms.makesLead, version: storefrontForms.version })
        .from(storefrontForms).where(and(eq(storefrontForms.id, form.id), eq(storefrontForms.isDeleted, 0), eq(storefrontForms.enabled, 1))).for('share');
      if (!live) throw formGone();
      if (live.version !== form.version) throw new ValidationError('این فرم عوض شده است؛ صفحه را دوباره باز کنید و فرم را از نو پر کنید.', undefined, 'STOREFRONT_MESSAGE_FORM_CHANGED');
      if (await sentThisHour(tx) >= MESSAGES_HOURLY_CAP) throw new MessagesBusyError();
      const leadId = live.makesLead === 1 ? await openSiteLead(tx, {
        title: `پیام سایت: ${live.title}`, contactName: firstAnswer(answers, 'shortText') || 'بازدیدکنندهٔ سایت', phone: firstAnswer(answers, 'mobile'), company: '',
        estimatedValue: '0', expectedCloseDate: '', notes: leadNotes(live.title, answers), audit: { formId: live.id, formTitle: live.title },
      }) : null;
      const [row] = await tx.insert(storefrontMessages).values({ formId: live.id, formTitle: live.title, answers, leadId, requestKey, requestHash }).returning();
      // the audit row says that a message came and through which form, never what it says
      await logActivity({
        tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: AUDIT_ENTITY, entityId: `message-${row.id}`,
        description: `پیامی از فرم «${live.title}» سایت رسید`, details: { after: { formId: live.id, formTitle: live.title, answered: answers.filter(answer => answer.value !== '').length, leadId } },
      });
      await notifyMessage(tx, row.id);
      await warnIfNearlyFull(tx);
      return answerOf(row);
    });
  } catch (err) {
    // the same request racing itself: the first one committed, the second answers its message
    if (!isRequestKeyViolation(err)) throw err;
    const raced = await replay(requestKey, requestHash);
    if (!raced) throw err;
    return raced;
  }
}

const listRowOf = (row: MessageRecord): MessageListRow => ({
  id: row.id, formId: row.formId, formTitle: row.formTitle, status: row.status, preview: messagePreview(Array.isArray(row.answers) ? row.answers : []), createdAt: row.createdAt, version: row.version,
});
const detailOf = (row: MessageRecord): MessageDetail => ({
  id: row.id, formId: row.formId, formTitle: row.formTitle, status: row.status, createdAt: row.createdAt, version: row.version,
  answers: Array.isArray(row.answers) ? row.answers : [], statusBy: row.statusBy, statusAt: row.statusAt ?? '', leadId: row.leadId,
});

/** `GET /api/storefront/messages`: the messages, the newest first, a page at a time, of one status or of all */
export async function listMessages(executor: DbExecutor, query: { page: number; status: MessageStatus | null }): Promise<MessageList> {
  const live = eq(storefrontMessages.isDeleted, 0);
  const grouped = await executor.select({ status: storefrontMessages.status, count: sql<number>`count(*)::int` }).from(storefrontMessages).where(live).groupBy(storefrontMessages.status);
  const counts = Object.fromEntries(MESSAGE_STATUSES.map(status => [status, grouped.find(g => g.status === status)?.count ?? 0])) as Record<MessageStatus, number>;
  const filter: SQL = query.status ? and(live, eq(storefrontMessages.status, query.status)) as SQL : live;
  const rows = await executor.select().from(storefrontMessages).where(filter).orderBy(desc(storefrontMessages.createdAt), desc(storefrontMessages.id))
    .limit(MESSAGES_PAGE_SIZE).offset((query.page - 1) * MESSAGES_PAGE_SIZE);
  const total = query.status ? counts[query.status] : MESSAGE_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  return { data: rows.map(listRowOf), total, page: query.page, pageSize: MESSAGES_PAGE_SIZE, counts };
}

/** `GET /api/storefront/messages/:id`: one message with every answer */
export async function messageDetail(executor: DbExecutor, id: number): Promise<MessageDetail> {
  const [row] = await executor.select().from(storefrontMessages).where(and(eq(storefrontMessages.id, id), eq(storefrontMessages.isDeleted, 0)));
  if (!row) throw notFound();
  return detailOf(row);
}

async function lockedRow(tx: DbExecutor, id: number, expectedVersion: number): Promise<MessageRecord> {
  const [row] = await tx.select().from(storefrontMessages).where(and(eq(storefrontMessages.id, id), eq(storefrontMessages.isDeleted, 0))).for('update');
  if (!row) throw notFound();
  if (row.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontMessage', entityId: String(id), expectedVersion, currentVersion: row.version });
  }
  return row;
}

/** `PUT /api/storefront/messages/:id/status`: «تازه», «دیده‌شده» or «پاسخ داده شد», sent as the state to take; a repeat changes nothing */
export async function setMessageStatus(req: Request, id: number, status: MessageStatus, version: number): Promise<MessageDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if (row.status === status) return;
    const at = systemNowUtcIso();
    const actor = actorOf(req);
    await tx.update(storefrontMessages).set({
      status, statusBy: status === 'new' ? '' : actor, statusAt: status === 'new' ? null : at, version: nextVersion(row.version), updatedAt: at,
    }).where(eq(storefrontMessages.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `message-${id}`,
      description: `پیام فرم «${row.formTitle}» به «${MESSAGE_STATUS_TITLES[status]}» رفت`, details: { before: { status: row.status }, after: { status } },
    });
  });
  return messageDetail(orm, id);
}

/** `DELETE /api/storefront/messages/:id`: the message is removed softly and is read nowhere after */
export async function deleteMessage(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    await tx.update(storefrontMessages).set({ isDeleted: 1, version: nextVersion(row.version), updatedAt: systemNowUtcIso() }).where(eq(storefrontMessages.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: AUDIT_ENTITY, entityId: `message-${id}`,
      description: `پیام فرم «${row.formTitle}» حذف شد`, details: { before: { formId: row.formId, formTitle: row.formTitle, status: row.status, leadId: row.leadId } },
    });
  });
}
