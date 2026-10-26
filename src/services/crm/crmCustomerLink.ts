import { and, eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { logActivity } from '../../lib/auditLogger.js';
import { findActiveCustomerByName, findActiveCustomerByPhone, isCustomerNameUniqueViolation, samePhone } from '../customers/customerIdentity.js';

/**
 * v9.0.5 (TD-418، تصمیم مالک محصول ت۲ الف): پرونده فروش فقط به طرف حساب پیوند می‌دهد یا طرف حساب تازه می‌سازد و هرگز
 * داده طرف حساب موجود (نام، تلفن، رابط) را عوض نمی‌کند. اختلاف پرونده با طرف حساب فقط در یادداشت پرونده ثبت می‌شود.
 * پیش‌تر ثبت و ویرایش پرونده نام و تلفن طرف حساب را بی افزایش نسخه بازنویسی می‌کرد: قفل خوش‌بینانه TD-403 دور زده
 * می‌شد و کاربری که فقط crm.manage داشت نام طرف حسابی را عوض می‌کرد که از فرم طرف حساب نمی‌توانست (۴۰۳).
 */

export interface CrmLeadPartyInput {
  customerId?: number | string | null;
  customerName?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
}

export interface CrmCustomerLink {
  customerId: number | null;
  /** اختلاف‌های پرونده با طرف حساب پیوندشده، هر کدام یک خط یادداشت */
  differences: string[];
}

type CustomerRow = typeof customers.$inferSelect;

const keep = 'طرف حساب تغییر نکرد.';

function phoneDifference(customer: CustomerRow, leadPhone: string): string | null {
  const current = (customer.phone ?? '').trim();
  // v9.0.7 (TD-419): همان شماره با نگارش دیگر اختلاف نیست
  if (!leadPhone || leadPhone === current || samePhone(leadPhone, current)) return null;
  const theirs = current ? `تلفن طرف حساب ${toPersianDigits(current)} است` : 'طرف حساب تلفن ندارد';
  return `اختلاف با طرف حساب «${customer.name}»: تلفن پرونده ${toPersianDigits(leadPhone)} و ${theirs}. ${keep}`;
}

function nameDifference(customer: CustomerRow, leadCompany: string): string | null {
  if (!leadCompany || leadCompany === customer.name.trim()) return null;
  return `اختلاف با طرف حساب «${customer.name}»: نام شرکت در پرونده «${leadCompany}» است. ${keep}`;
}

function linkTo(customer: CustomerRow, differences: Array<string | null>): CrmCustomerLink {
  return { customerId: customer.id, differences: differences.filter((d): d is string => d !== null) };
}

/** who saves the lead; the party a lead creates gets its own audit row in that name */
export interface CrmLeadActor {
  userId?: number;
  username?: string;
}

/**
 * v11 phase 6.1b (C5): the name of a party made from a lead that has only a phone: neutral and the phone's own, never the
 * lead title. Before, «Call from website about doors» became a party, and a second lead with the same title and another
 * phone was linked to it.
 */
export function phoneOnlyPartyName(phone: string): string {
  return `مشتری تلفن ${toPersianDigits(phone)}`;
}

export async function linkCustomerForLead(input: CrmLeadPartyInput, db: DbExecutor = orm, actor: CrmLeadActor = {}): Promise<CrmCustomerLink> {
  const cName = input.customerName?.trim() || '';
  const cCompany = input.company?.trim() || '';
  const cPhone = input.phone?.trim() || '';

  // نام شرکت، اگر باشد، نام طرف حساب است و نام مخاطب رابط او؛ v11 phase 6.1b (C5): بی آن دو، نامی از تلفن، نه عنوان پرونده
  const primaryCustomerName = cCompany || cName || (cPhone ? phoneOnlyPartyName(cPhone) : '');
  const contactPersonName = cCompany ? cName : (cName !== primaryCustomerName ? cName : '');

  if (!cName && !cCompany && !cPhone && !input.customerId) {
    return { customerId: null, differences: [] };
  }

  const active = (cond: ReturnType<typeof eq>) => db.select().from(customers).where(and(cond, eq(customers.isDeleted, 0))).limit(1);

  const explicitId = input.customerId ? Number(input.customerId) : 0;
  if (explicitId > 0) {
    const [byId] = await active(eq(customers.id, explicitId));
    if (byId) return linkTo(byId, [nameDifference(byId, cCompany), phoneDifference(byId, cPhone)]);
  }

  // v9.0.7 (TD-419): طرف حساب با کلید تطبیق تلفن پیدا می‌شود، نه برابری دقیق رشته
  const byPhone = await findActiveCustomerByPhone(cPhone, db);
  if (byPhone) return linkTo(byPhone, [nameDifference(byPhone, cCompany)]);

  // a lead naming only a party that no longer exists makes no party (no name to give it)
  if (!primaryCustomerName) return { customerId: null, differences: [] };

  // v9.0.8 (TD-420): نام با کلید ایندکس یکتای نام طرف حساب فعال
  const byName = await findActiveCustomerByName(primaryCustomerName, db);
  if (byName) return linkTo(byName, [phoneDifference(byName, cPhone)]);

  // v10.0.179 (OBS-R2-33): درج درون savepoint، تا درون تراکنش ویرایش یا تبدیل پرونده هم پس از تکرار نام، خواندن برنده ممکن باشد
  // v11 phase 6.1b (C5): the party's own audit row, in the same savepoint
  const [created] = await db.transaction(async sp => {
    const rows = await sp.insert(customers).values({
      name: primaryCustomerName,
      contactName: contactPersonName || cName,
      phone: cPhone,
      notes: 'ثبت خودکار از پرونده فروش',
      createdAt: systemNowUtcIso(),
      isDeleted: 0,
    }).returning({ id: customers.id });
    await logActivity({
      tx: sp,
      userId: actor.userId,
      username: actor.username || 'سیستم',
      action: 'CREATE',
      entity: 'طرف حساب',
      entityId: rows[0].id,
      description: `ثبت خودکار طرف حساب «${primaryCustomerName}» از پرونده فروش «${input.title?.trim() || ''}»`,
      details: { after: { id: rows[0].id, name: primaryCustomerName, phone: cPhone } },
    });
    return rows;
  }).catch(async (err: unknown) => {
    // درخواست هم‌زمان همین نام را ساخت: به همان طرف حساب پیوند می‌دهد
    const winner = isCustomerNameUniqueViolation(err) ? await findActiveCustomerByName(primaryCustomerName, db) : undefined;
    if (!winner) throw err;
    return [{ id: winner.id }];
  });
  return { customerId: created ? created.id : null, differences: [] };
}

/** خط‌های اختلاف را یک بار به یادداشت پرونده می‌افزاید (ذخیره دوباره همان پرونده خط تکراری نمی‌سازد) */
export function notesWithPartyDifferences(notes: string | null | undefined, differences: string[]): string {
  const base = notes ?? '';
  const present = new Set(base.split('\n').map(l => l.trim()));
  const added = differences.filter(d => !present.has(d));
  if (added.length === 0) return base;
  return base.trim() ? `${base.trimEnd()}\n${added.join('\n')}` : added.join('\n');
}
