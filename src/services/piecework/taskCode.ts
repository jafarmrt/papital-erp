import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { pieceworkTasks } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';

/**
 * کد خودکار عنوان کاری پرکیسی (TD-243، AGENTS §1.6): شماره از توالی اتمیک `piecework_task_code_seq`
 * (مهاجرت 0036) می‌آید، نه COUNT(*)/MAX()+1. قالب کد مانند قبل `PW-` + دست‌کم سه رقم است.
 * اگر کدی با همان شماره از قبل وجود داشته باشد (کد دستی، ورود اکسل یا ردیف حذف‌شده)، در همان
 * اجراکننده شماره بعدی توالی گرفته می‌شود؛ هیچ کد موجودی بازتولید نمی‌شود.
 */
export const PIECEWORK_TASK_CODE_SEQUENCE = 'piecework_task_code_seq';

const TASK_CODE_PATTERN = /^PW-0*(\d+)$/i;
const MAX_SKIPS = 1000;

/** شماره بدون صفرهای پیشرو (رشته، تا کد دستی بسیار بلند سرریز عددی نسازد) */
function normalizedNumber(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

export function formatPieceworkTaskCode(seq: number | string): string {
  return `PW-${String(seq).padStart(3, '0')}`;
}

/** شماره‌های کدهای `PW-<رقم>` همه عناوین (حذف‌شده هم) — PW-7 و PW-007 یک شماره‌اند */
export async function loadTakenPieceworkTaskNumbers(executor: DbExecutor): Promise<Set<string>> {
  const rows = await executor.select({ code: pieceworkTasks.code }).from(pieceworkTasks)
    .where(sql`btrim(${pieceworkTasks.code}) ILIKE 'PW-%'`);
  const taken = new Set<string>();
  for (const row of rows) markPieceworkTaskCodeTaken(taken, row.code);
  return taken;
}

/** کد درج‌شده (دستی یا خودکار) را در مجموعه شماره‌های گرفته‌شده ثبت می‌کند */
export function markPieceworkTaskCodeTaken(taken: Set<string>, code: string): void {
  const m = String(code ?? '').trim().match(TASK_CODE_PATTERN);
  if (m) taken.add(normalizedNumber(m[1]));
}

async function nextSequenceValue(executor: DbExecutor): Promise<string> {
  const result = await executor.execute(sql`SELECT nextval('piecework_task_code_seq') AS num`);
  const raw = (result as unknown as { rows?: Array<{ num?: string | number }> }).rows?.[0]?.num;
  const num = String(raw ?? '');
  if (!/^\d+$/.test(num)) {
    throw new Error(`مقدار نامعتبر از توالی ${PIECEWORK_TASK_CODE_SEQUENCE}: ${num}`);
  }
  return normalizedNumber(num);
}

/**
 * کد خودکار بعدی. `taken` (اختیاری) مجموعه شماره‌های گرفته‌شده است تا ورود اکسل برای هر ردیف دوباره
 * جدول را نخواند؛ کد تخصیص‌یافته به آن افزوده می‌شود.
 */
export async function allocatePieceworkTaskCode(executor: DbExecutor, taken?: Set<string>): Promise<string> {
  const used = taken ?? await loadTakenPieceworkTaskNumbers(executor);
  for (let i = 0; i <= MAX_SKIPS; i++) {
    const num = await nextSequenceValue(executor);
    if (!used.has(num)) {
      used.add(num);
      return formatPieceworkTaskCode(num);
    }
  }
  throw new ConflictError(`پس از ${MAX_SKIPS} تلاش کد خودکار آزاد برای عنوان کاری پیدا نشد؛ کد را دستی وارد کنید.`);
}

/**
 * یکتایی کد عناوین کاری فعال (TD-246، تصمیم مالک محصول «قید یکتا»): دو عنوان کاری فعال (is_deleted = 0) هم‌کد
 * نمی‌شوند؛ عنوان حذف‌شده حساب نمی‌شود. کلید یکتایی `lower(btrim(code))` است (کدی که فقط در حروف بزرگ/کوچک یا
 * فاصله ابتدا و انتها فرق دارد همان کد است). مهاجرت 0037 ایندکس یکتای جزئی uq_ptask_code_active را فقط روی داده
 * بدون کد تکراری می‌سازد (کد عناوین قدیمی هرگز خودکار عوض نمی‌شود) و بازرس سلامت مالی تکراری‌ها را فهرست می‌کند.
 * کد خودکار (allocatePieceworkTaskCode) سخت‌گیرانه‌تر است: شماره هر کد PW-<رقم> فعال یا حذف‌شده را رد می‌کند.
 */
export const PIECEWORK_TASK_CODE_UNIQUE_INDEX = 'uq_ptask_code_active';

/** همان کلید ایندکس uq_ptask_code_active، برای مقایسه در حافظه (ورود اکسل) */
export function pieceworkTaskCodeKey(code: string | null | undefined): string {
  return String(code ?? '').trim().toLowerCase();
}

export function pieceworkTaskCodeConflictError(code: string, existingTitle?: string | null): ConflictError {
  const owner = existingTitle ? ` برای عنوان کاری فعال «${existingTitle}»` : ' برای عنوان کاری فعال دیگری';
  return new ConflictError(`کد عنوان کاری «${String(code).trim()}» قبلاً${owner} ثبت شده است؛ کد دیگری وارد کنید.`, { code: String(code).trim() });
}

/**
 * اگر عنوان کاری فعال دیگری (جز excludeId) همین کد را داشته باشد ConflictError می‌دهد. مقایسه با همان عبارت
 * ایندکس (lower(btrim(code))) در پایگاه‌داده انجام می‌شود تا بررسی برنامه و قید پایگاه‌داده یکسان باشند.
 */
export async function assertPieceworkTaskCodeAvailable(executor: DbExecutor, code: string, excludeId?: number): Promise<void> {
  const conditions = [
    sql`${pieceworkTasks.isDeleted} = 0`,
    sql`lower(btrim(${pieceworkTasks.code})) = lower(btrim(${String(code)}::text))`,
  ];
  if (excludeId !== undefined) conditions.push(sql`${pieceworkTasks.id} <> ${excludeId}`);
  const [taken] = await executor.select({ id: pieceworkTasks.id, title: pieceworkTasks.title })
    .from(pieceworkTasks)
    .where(sql.join(conditions, sql` AND `))
    .orderBy(asc(pieceworkTasks.id))
    .limit(1);
  if (taken) throw pieceworkTaskCodeConflictError(code, taken.title);
}

/** خطای 23505 روی ایندکس uq_ptask_code_active (Drizzle خطای pg را در `cause` می‌پیچد) */
export function isPieceworkTaskCodeUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === PIECEWORK_TASK_CODE_UNIQUE_INDEX) return true;
  }
  return false;
}

/** پنجره رقابتی بین بررسی و درج: نقض ایندکس به همان پیام فارسی تبدیل می‌شود؛ هر خطای دیگر دست‌نخورده برمی‌گردد */
export function toPieceworkTaskCodeError(err: unknown, code: string): unknown {
  return isPieceworkTaskCodeUniqueViolation(err) ? pieceworkTaskCodeConflictError(code) : err;
}

export interface DuplicatePieceworkTaskCodeRow {
  id: number;
  code: string;
  title: string;
  category: string | null;
  isActive: number | null;
}

/** همه عناوین کاری فعالی که کدشان (با کلید lower(btrim)) با عنوان فعال دیگری یکی است، به ترتیب کد و شناسه */
export async function findDuplicatePieceworkTaskCodes(executor: DbExecutor = orm): Promise<DuplicatePieceworkTaskCodeRow[]> {
  const key = sql`lower(btrim(${pieceworkTasks.code}))`;
  const duplicated = executor.select({ k: sql<string>`${key}`.as('k') })
    .from(pieceworkTasks)
    .where(eq(pieceworkTasks.isDeleted, 0))
    .groupBy(key)
    .having(sql`COUNT(*) > 1`);
  return await executor.select({
    id: pieceworkTasks.id,
    code: pieceworkTasks.code,
    title: pieceworkTasks.title,
    category: pieceworkTasks.category,
    isActive: pieceworkTasks.isActive,
  })
    .from(pieceworkTasks)
    .where(and(eq(pieceworkTasks.isDeleted, 0), inArray(key, duplicated)))
    .orderBy(asc(key), asc(pieceworkTasks.id));
}

export async function hasPieceworkTaskCodeUniqueIndex(executor: DbExecutor = orm): Promise<boolean> {
  const res = await executor.execute(sql`SELECT to_regclass(${PIECEWORK_TASK_CODE_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}
