import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import type { HealthCheckTestResult } from '../../types.js';
import { formatPersianNationalId, normalizeNationalId } from '../../utils/cardValidation.js';

/**
 * OBS-R2-56 (ت۴۰): a non-empty national ID is unique among active personnel, like the personnel code (TD-439). The key is
 * `btrim(national_id)` (the form stores it normalized); migration 0122 builds the partial unique index
 * uq_personnel_national_id_active only on data without duplicates, and the financial health check lists the duplicates
 * that are left (personnel_national_id_uniqueness); old values are never changed.
 */
export const PERSONNEL_NATIONAL_ID_UNIQUE_INDEX = 'uq_personnel_national_id_active';

/** the national ID as the form stores it (Latin digits, no separators), so an unnormalized legacy value is not a change */
export function personnelNationalIdKey(nationalId: unknown): string {
  return normalizeNationalId(nationalId === null || nationalId === undefined ? '' : String(nationalId));
}

export function personnelNationalIdTakenMessage(nationalId: string): string {
  return `کد ملی «${formatPersianNationalId(personnelNationalIdKey(nationalId))}» برای پرسنل دیگری ثبت شده است.`;
}

const takenError = (nationalId: string) =>
  new ConflictError(personnelNationalIdTakenMessage(nationalId), undefined, 'PERSONNEL_NATIONAL_ID_TAKEN');

/** an empty national ID is free; one held by another active personnel (other than excludeId) is 409 */
export async function assertPersonnelNationalIdAvailable(nationalId: string, db: DbExecutor, excludeId?: number): Promise<void> {
  const key = personnelNationalIdKey(nationalId);
  if (!key) return;
  const conditions = [sql`btrim(${personnel.nationalId}) = ${key}::text`, eq(personnel.isDeleted, 0)];
  if (excludeId !== undefined) conditions.push(ne(personnel.id, excludeId));
  const [other] = await db.select({ id: personnel.id }).from(personnel).where(and(...conditions)).limit(1);
  if (other) throw takenError(key);
}

/** a 23505 on uq_personnel_national_id_active (Drizzle wraps the pg error in `cause`) */
export function isPersonnelNationalIdUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === PERSONNEL_NATIONAL_ID_UNIQUE_INDEX) return true;
  }
  return false;
}

/** the race between the check and the write: a violation of the index is the same Persian 409 */
export async function guardPersonnelNationalId<T>(nationalId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    throw isPersonnelNationalIdUniqueViolation(err) ? takenError(nationalId) : err;
  }
}

export interface DuplicatePersonnelNationalIdRow {
  id: number;
  fullName: string;
  nationalId: string;
}

export async function findDuplicatePersonnelNationalIds(db: DbExecutor): Promise<DuplicatePersonnelNationalIdRow[]> {
  const key = sql`btrim(${personnel.nationalId})`;
  const rows = await db.select({ id: personnel.id, fullName: personnel.fullName, nationalId: personnel.nationalId })
    .from(personnel)
    .where(and(eq(personnel.isDeleted, 0), sql`${key} IN (
      SELECT btrim(p.national_id) FROM personnel p
      WHERE p.is_deleted = 0 AND btrim(p.national_id) <> ''
      GROUP BY btrim(p.national_id) HAVING COUNT(*) > 1
    )`))
    .orderBy(asc(key), asc(personnel.id));
  return rows.map(r => ({ ...r, nationalId: r.nationalId ?? '' }));
}

export async function hasPersonnelNationalIdUniqueIndex(db: DbExecutor): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(format('%I.%I', current_schema(), ${PERSONNEL_NATIONAL_ID_UNIQUE_INDEX}::text)) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

/** where the system admin builds a unique index a migration skipped on dirty data (CONDITIONAL_CONSTRAINT_RULES) */
export const UNIQUE_INDEX_BUILD_HINT = 'قید را از کارت «قیدهای جاافتاده پایگاه‌داده» در «عملیات سامانه» با «ساختن قیدهای جاافتاده» بسازید.';

export function buildPersonnelNationalIdHealthTest(duplicates: DuplicatePersonnelNationalIdRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const idsByKey = new Map<string, number[]>();
  for (const r of duplicates) {
    const k = personnelNationalIdKey(r.nationalId);
    idsByKey.set(k, [...(idsByKey.get(k) ?? []), r.id]);
  }
  const duplicateCount = idsByKey.size;
  return {
    id: 'personnel_national_id_uniqueness',
    category: 'system',
    title: 'یکتایی کد ملی پرسنل',
    description: 'کد ملی غیرخالی میان پرسنل فعال یکتاست و پایگاه‌داده با ایندکس یکتا از کد ملی تکراری جلوگیری می‌کند',
    status: duplicateCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, duplicateCount * 2),
    count: duplicateCount,
    message: duplicateCount > 0
      ? `${duplicateCount.toLocaleString('fa-IR')} کد ملی میان بیش از یک پرسنل فعال تکرار شده و قید یکتایی در پایگاه‌داده اعمال نشده است؛ کدها خودکار عوض نمی‌شوند. کد درست را در فرم پرسنل بگذارید یا پرسنل تکراری را حذف کنید، سپس ${UNIQUE_INDEX_BUILD_HINT}`
      : (uniqueIndexPresent
        ? 'هیچ کد ملی میان پرسنل فعال تکرار نشده و پایگاه‌داده از کد ملی تکراری جلوگیری می‌کند.'
        : `هیچ کد ملی میان پرسنل فعال تکرار نشده اما قید یکتایی در پایگاه‌داده اعمال نشده است؛ ${UNIQUE_INDEX_BUILD_HINT}`),
    items: duplicates.map((r) => ({
      id: r.id,
      code: `کد ملی ${formatPersianNationalId(personnelNationalIdKey(r.nationalId))}`,
      title: r.fullName,
      subtitle: `کد ملی: ${formatPersianNationalId(personnelNationalIdKey(r.nationalId))}`,
      details: `پرسنل فعال با همین کد ملی: ${(idsByKey.get(personnelNationalIdKey(r.nationalId)) ?? [r.id]).map((id) => `#${id.toLocaleString('fa-IR', { useGrouping: false })}`).join('، ')}`,
    })),
    metrics: { duplicateNationalIds: duplicateCount, duplicatePersonnelRows: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
