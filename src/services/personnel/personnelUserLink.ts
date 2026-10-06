import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { personnel, users } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.24 (TD-435، تصمیم مالک محصول D2 الف): هر کاربر سامانه حداکثر به یک پرسنل فعال وصل می‌شود و فقط به کاربری
 * که وجود دارد و حذف نشده است. «فیش‌های من» (`/piecework/payrolls/mine`) فیش همه پرسنلِ وصل به کاربر را می‌دهد، پس
 * پیوند دوم فیش، کارت و شبای پرسنل دیگری را به این کاربر نشان می‌داد. بررسی زیر قفل ردیف کاربر است و ایندکس یکتای
 * جزئی uq_personnel_user_active (مهاجرت 0053، فقط روی داده بی پیوند تکراری) پشتوانه پایگاه‌داده است. پیوندهای تکراری
 * قدیمی خودکار عوض نمی‌شوند: بازرس سلامت مالی آن‌ها را فهرست می‌کند و «فیش‌های من» برای چنین کاربری فیشی نمی‌دهد.
 */
export const PERSONNEL_USER_UNIQUE_INDEX = 'uq_personnel_user_active';

const INVALID_USER_MESSAGE = 'کاربر انتخاب‌شده برای اتصال به پرسنل وجود ندارد یا حذف شده است.';

/** شناسه کاربر ورودی فرم: خالی یا صفر یعنی بی کاربر؛ هر مقدار دیگر باید شناسه عددی مثبت باشد */
export function parsePersonnelUserId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') return null;
  const id = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(INVALID_USER_MESSAGE);
  return id;
}

function linkTakenMessage(fullName?: string | null): string {
  const who = fullName ? `پرسنل «${fullName}»` : 'پرسنل دیگری';
  return `این کاربر پیش‌تر به ${who} وصل است؛ هر کاربر فقط به یک پرسنل فعال وصل می‌شود.`;
}

/**
 * پیوند کاربر برای ثبت یا ویرایش پرسنل، درون تراکنش نوشتن: ردیف کاربر قفل می‌شود (درخواست‌های هم‌زمان با یک کاربر پشت
 * سر هم می‌آیند)، کاربر ناموجود یا حذف‌شده ۴۲۲ و کاربرِ وصل به پرسنل فعال دیگر ۴۰۹ می‌گیرد.
 */
export async function resolvePersonnelUserLink(tx: DbExecutor, raw: unknown, personnelId?: number): Promise<number | null> {
  const userId = parsePersonnelUserId(raw);
  if (userId === null) return null;
  const [user] = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.isDeleted, 0)))
    .for('no key update');
  if (!user) throw new ValidationError(INVALID_USER_MESSAGE);
  const conditions = [eq(personnel.userId, userId), eq(personnel.isDeleted, 0)];
  if (personnelId !== undefined) conditions.push(ne(personnel.id, personnelId));
  const [other] = await tx.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel)
    .where(and(...conditions)).orderBy(asc(personnel.id)).limit(1);
  if (other) throw new ConflictError(linkTakenMessage(other.fullName));
  return userId;
}

/** خطای 23505 روی ایندکس uq_personnel_user_active (Drizzle خطای pg را در `cause` می‌پیچد) */
export function isPersonnelUserUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === PERSONNEL_USER_UNIQUE_INDEX) return true;
  }
  return false;
}

/** پنجره رقابتی میان بررسی و نوشتن: نقض ایندکس همان پیام فارسی پیوند تکراری می‌شود */
export async function guardPersonnelUserLink<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    throw isPersonnelUserUniqueViolation(err) ? new ConflictError(linkTakenMessage()) : err;
  }
}

/** پرسنل فعال وصل به این کاربر برای «فیش‌های من»؛ پیوند تکراری قدیمی ۴۰۹ می‌گیرد، نه فیش هر دو پرسنل */
export async function personnelIdsOfUser(userId: number, db: DbExecutor = orm): Promise<number[]> {
  const rows = await db.select({ id: personnel.id }).from(personnel)
    .where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0)));
  if (rows.length > 1) {
    throw new ConflictError('حساب کاربری شما به بیش از یک پرسنل وصل است؛ تا مدیر پیوند درست را مشخص نکند فیش‌ها نمایش داده نمی‌شوند.');
  }
  return rows.map(r => r.id);
}

export interface DuplicatePersonnelUserLinkRow {
  id: number;
  fullName: string;
  personnelCode: string | null;
  userId: number;
  username: string | null;
}

export async function findDuplicatePersonnelUserLinks(db: DbExecutor = orm): Promise<DuplicatePersonnelUserLinkRow[]> {
  const duplicated = db.select({ u: personnel.userId }).from(personnel)
    .where(and(eq(personnel.isDeleted, 0), isNotNull(personnel.userId)))
    .groupBy(personnel.userId)
    .having(sql`COUNT(*) > 1`);
  const rows = await db.select({
    id: personnel.id, fullName: personnel.fullName, personnelCode: personnel.personnelCode, userId: personnel.userId, username: users.username,
  })
    .from(personnel)
    .leftJoin(users, eq(personnel.userId, users.id))
    .where(and(eq(personnel.isDeleted, 0), inArray(personnel.userId, duplicated)))
    .orderBy(asc(personnel.userId), asc(personnel.id));
  return rows.map(r => ({ ...r, userId: Number(r.userId) }));
}

export async function hasPersonnelUserUniqueIndex(db: DbExecutor = orm): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(${PERSONNEL_USER_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildPersonnelUserLinkHealthTest(duplicates: DuplicatePersonnelUserLinkRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const idsByUser = new Map<number, number[]>();
  for (const r of duplicates) idsByUser.set(r.userId, [...(idsByUser.get(r.userId) ?? []), r.id]);
  const duplicateUserCount = idsByUser.size;
  return {
    id: 'personnel_user_link_uniqueness',
    category: 'system',
    title: 'یکتایی اتصال کاربر به پرسنل',
    description: 'هر کاربر سامانه حداکثر به یک پرسنل فعال وصل می‌شود؛ «فیش‌های من» فیش پرسنلِ وصل به کاربر را نشان می‌دهد و پایگاه‌داده با ایندکس یکتا از پیوند تکراری جلوگیری می‌کند',
    status: duplicateUserCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, duplicateUserCount * 2),
    count: duplicateUserCount,
    message: duplicateUserCount > 0
      ? `${duplicateUserCount} کاربر به بیش از یک پرسنل فعال وصل است و قید یکتایی در پایگاه‌داده اعمال نشده است؛ پیوندها خودکار عوض نمی‌شوند و «فیش‌های من» برای این کاربران فیشی نشان نمی‌دهد تا مدیر پیوند نادرست را از فرم پرسنل بردارد.`
      : (uniqueIndexPresent
        ? 'هیچ کاربری به بیش از یک پرسنل فعال وصل نیست و پایگاه‌داده از پیوند تکراری جلوگیری می‌کند.'
        : 'هیچ کاربری به بیش از یک پرسنل فعال وصل نیست اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map((r) => ({
      id: r.id,
      code: r.personnelCode ? `پرسنل ${r.personnelCode}` : `پرسنل #${r.id}`,
      title: r.fullName,
      subtitle: `کاربر: ${r.username || `#${r.userId}`}`,
      details: `پرسنل وصل به همین کاربر: ${(idsByUser.get(r.userId) ?? [r.id]).map((id) => `#${id}`).join('، ')} (TD-435).`,
    })),
    metrics: { duplicateUsers: duplicateUserCount, duplicatePersonnelRows: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
