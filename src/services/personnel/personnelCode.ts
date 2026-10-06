import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { BadRequestError } from '../../errors/customErrors.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.28 (TD-439، تصمیم مالک محصول D6 الف): کد پرسنلی غیرخالی میان پرسنل فعال یکتاست. کلید `lower(btrim(code))` است
 * (کدی که فقط در حروف بزرگ و کوچک یا فاصله ابتدا و انتها فرق دارد همان کد است، در فرم و ورود اکسل). مهاجرت 0054 ایندکس
 * یکتای جزئی uq_personnel_code_active را فقط روی داده بی کد تکراری می‌سازد و بازرس سلامت مالی تکراری‌ها را فهرست می‌کند.
 * پیش‌تر بررسی «بخوان، بعد بنویس» بی قفل و قید بود و درخواست‌های هم‌زمان با یک کد دو پرسنل فعال می‌ساختند.
 */
export const PERSONNEL_CODE_UNIQUE_INDEX = 'uq_personnel_code_active';

/** کلید مقایسه کد پرسنلی؛ رشته خالی یعنی بی کد */
export function personnelCodeKey(code: unknown): string {
  return String(code ?? '').trim().toLowerCase();
}

export function personnelCodeTakenMessage(code: string): string {
  return `کد پرسنلی «${code.trim()}» قبلاً برای پرسنل دیگری ثبت شده است.`;
}

/** کد خالی آزاد است؛ کد پرسنل فعال دیگر (جز excludeId) ۴۰۰ */
export async function assertPersonnelCodeAvailable(code: string, db: DbExecutor = orm, excludeId?: number): Promise<void> {
  const key = personnelCodeKey(code);
  if (!key) return;
  const conditions = [sql`lower(btrim(${personnel.personnelCode})) = ${key}::text`, eq(personnel.isDeleted, 0)];
  if (excludeId !== undefined) conditions.push(ne(personnel.id, excludeId));
  const [other] = await db.select({ id: personnel.id }).from(personnel).where(and(...conditions)).limit(1);
  if (other) throw new BadRequestError(personnelCodeTakenMessage(code));
}

/** خطای 23505 روی ایندکس uq_personnel_code_active (Drizzle خطای pg را در `cause` می‌پیچد) */
export function isPersonnelCodeUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === PERSONNEL_CODE_UNIQUE_INDEX) return true;
  }
  return false;
}

/** پنجره رقابتی میان بررسی و نوشتن: نقض ایندکس همان پیام فارسی کد تکراری می‌شود */
export async function guardPersonnelCode<T>(code: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    throw isPersonnelCodeUniqueViolation(err) ? new BadRequestError(personnelCodeTakenMessage(code)) : err;
  }
}

export interface DuplicatePersonnelCodeRow {
  id: number;
  fullName: string;
  personnelCode: string;
}

export async function findDuplicatePersonnelCodes(db: DbExecutor = orm): Promise<DuplicatePersonnelCodeRow[]> {
  const key = sql`lower(btrim(${personnel.personnelCode}))`;
  const rows = await db.select({ id: personnel.id, fullName: personnel.fullName, personnelCode: personnel.personnelCode })
    .from(personnel)
    .where(and(eq(personnel.isDeleted, 0), sql`${key} IN (
      SELECT lower(btrim(p.personnel_code)) FROM personnel p
      WHERE p.is_deleted = 0 AND btrim(p.personnel_code) <> ''
      GROUP BY lower(btrim(p.personnel_code)) HAVING COUNT(*) > 1
    )`))
    .orderBy(asc(key), asc(personnel.id));
  return rows.map(r => ({ ...r, personnelCode: r.personnelCode ?? '' }));
}

export async function hasPersonnelCodeUniqueIndex(db: DbExecutor = orm): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(${PERSONNEL_CODE_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildPersonnelCodeHealthTest(duplicates: DuplicatePersonnelCodeRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const idsByCode = new Map<string, number[]>();
  for (const r of duplicates) {
    const k = personnelCodeKey(r.personnelCode);
    idsByCode.set(k, [...(idsByCode.get(k) ?? []), r.id]);
  }
  const duplicateCodeCount = idsByCode.size;
  return {
    id: 'personnel_code_uniqueness',
    category: 'system',
    title: 'یکتایی کد پرسنلی',
    description: 'کد پرسنلی غیرخالی میان پرسنل فعال یکتاست (بی حساسیت به حروف و فاصله ابتدا و انتها)؛ ورود اکسل پرسنل را با همین کد پیدا می‌کند و پایگاه‌داده با ایندکس یکتا از کد تکراری جلوگیری می‌کند',
    status: duplicateCodeCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, duplicateCodeCount * 2),
    count: duplicateCodeCount,
    message: duplicateCodeCount > 0
      ? `${duplicateCodeCount} کد پرسنلی میان بیش از یک پرسنل فعال تکرار شده و قید یکتایی در پایگاه‌داده اعمال نشده است؛ کدها خودکار عوض نمی‌شوند و تا مدیر کد درست را در فرم پرسنل نگذارد، ورود اکسل نخستین پرسنل همان کد را به‌روز می‌کند.`
      : (uniqueIndexPresent
        ? 'هیچ کد پرسنلی میان پرسنل فعال تکرار نشده و پایگاه‌داده از کد تکراری جلوگیری می‌کند.'
        : 'هیچ کد پرسنلی میان پرسنل فعال تکرار نشده اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map((r) => ({
      id: r.id,
      code: `پرسنل ${r.personnelCode.trim()}`,
      title: r.fullName,
      subtitle: `کد پرسنلی: ${r.personnelCode.trim()}`,
      details: `پرسنل فعال با همین کد: ${(idsByCode.get(personnelCodeKey(r.personnelCode)) ?? [r.id]).map((id) => `#${id}`).join('، ')} (TD-439).`,
    })),
    metrics: { duplicateCodes: duplicateCodeCount, duplicatePersonnelRows: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
