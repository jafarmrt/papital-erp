import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { personnel, pieceworkPersonnelRates, pieceworkTaskRateHistory, pieceworkTasks } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { parsePieceworkRate } from '../../lib/piecework/pieceworkRate.js';
import type { HealthCheckTestResult } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.284 (TD-809، B12P-06): نرخ اختصاصی پرسنل. پیش‌تر «بخوان، سپس درج یا ویرایش» بی تراکنش و قفل بود: پنج ذخیره هم‌زمان دو
 * ردیف فعال ساخت، صفحه نرخ‌ها ۱۶۰٬۰۰۰ نشان داد و کارکرد با ۱۹۰٬۰۰۰ ثبت شد؛ «-50000» و پرسنل ناموجود پذیرفته شد و هیچ ممیزی و
 * تاریخچه‌ای نماند. اکنون نرخ نامنفی است، پرسنل زنده `FOR UPDATE` (ذخیره‌های یک پرسنل پشت هم) و عنوان کار زنده `FOR SHARE`
 * قفل می‌شوند، یک ردیف فعال برای هر پرسنل و کار می‌ماند (ایندکس یکتای جزئی مهاجرت 0076) و هر تغییر یک ردیف تاریخچه نرخ (با
 * `personnel_id`) و یک ردیف ممیزی با قبل و بعد در همان تراکنش دارد. ردیف‌های تکراری قدیمی خودکار حذف نمی‌شوند: بازرس سلامت
 * مالی فهرستشان می‌کند و کارکرد و صفحه نرخ‌ها هر دو تازه‌ترین ردیف را می‌خوانند.
 */
export const PERSONNEL_RATE_UNIQUE_INDEX = 'uq_piecework_personnel_rates_active';
export const PERSONNEL_RATE_AUDIT_ENTITY = 'نرخ اختصاصی پرسنل';

export interface PersonnelRateInput {
  personnelId: unknown;
  taskId: unknown;
  customRate: unknown;
}

export interface RateActor {
  req?: unknown;
  userId?: number;
  username?: string;
}

const INVALID = 'PIECEWORK_RATE_INVALID';

function rateId(raw: unknown, label: string): number {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^[1-9]\d*$/.test(text)) throw new ValidationError(`${label} باید عدد صحیح مثبت باشد`, { [label]: raw }, INVALID);
  return Number(text);
}

/** تازه‌ترین نرخ اختصاصی فعال (همان که صفحه نرخ‌ها آخر از همه نشان می‌دهد)؛ ترتیب قطعی حتی با ردیف تکراری قدیمی */
export async function activePersonnelRate(executor: DbExecutor, personnelId: number, taskId: number) {
  const [row] = await executor.select().from(pieceworkPersonnelRates)
    .where(and(eq(pieceworkPersonnelRates.personnelId, personnelId), eq(pieceworkPersonnelRates.taskId, taskId), eq(pieceworkPersonnelRates.isDeleted, 0)))
    .orderBy(desc(pieceworkPersonnelRates.id))
    .limit(1);
  return row;
}

function isPersonnelRateUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === PERSONNEL_RATE_UNIQUE_INDEX) return true;
  }
  return false;
}

/** ذخیره نرخ اختصاصی در تراکنش فراخواننده؛ نرخ بدون تغییر چیزی نمی‌نویسد */
export async function savePersonnelRate(tx: DbExecutor, input: PersonnelRateInput, actor: RateActor = {}): Promise<{ id: number; changed: boolean }> {
  const personnelId = rateId(input.personnelId, 'شناسه پرسنل');
  const taskId = rateId(input.taskId, 'شناسه عنوان کار');
  const parsed = parsePieceworkRate(input.customRate, 'نرخ اختصاصی');
  if (!parsed.ok) throw new ValidationError(parsed.message, { customRate: input.customRate }, INVALID);
  if (parsed.value === undefined) throw new ValidationError('نرخ اختصاصی الزامی است', { customRate: input.customRate }, INVALID);
  const newRate = money(parsed.value);

  const [person] = await tx.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel)
    .where(and(eq(personnel.id, personnelId), eq(personnel.isDeleted, 0))).for('update');
  if (!person) {
    throw new ValidationError(`پرسنل با شناسه ${toPersianDigits(personnelId)} وجود ندارد یا حذف شده است؛ نرخی ثبت نشد.`, { personnelId }, 'PIECEWORK_RATE_PERSONNEL_INVALID');
  }
  const [task] = await tx.select({ id: pieceworkTasks.id, code: pieceworkTasks.code, title: pieceworkTasks.title, defaultRate: pieceworkTasks.defaultRate })
    .from(pieceworkTasks).where(and(eq(pieceworkTasks.id, taskId), eq(pieceworkTasks.isDeleted, 0))).for('share');
  if (!task) {
    throw new ValidationError(`عنوان کاری با شناسه ${toPersianDigits(taskId)} وجود ندارد یا حذف شده است؛ نرخی ثبت نشد.`, { taskId }, 'PIECEWORK_RATE_TASK_INVALID');
  }

  const current = await activePersonnelRate(tx, personnelId, taskId);
  if (current && fin(current.customRate).equals(newRate)) return { id: current.id, changed: false };

  let id: number;
  if (current) {
    await tx.update(pieceworkPersonnelRates).set({ customRate: newRate, updatedAt: sql`NOW()` }).where(eq(pieceworkPersonnelRates.id, current.id));
    id = current.id;
  } else {
    try {
      const [inserted] = await tx.insert(pieceworkPersonnelRates).values({ personnelId, taskId, customRate: newRate, isDeleted: 0 })
        .returning({ id: pieceworkPersonnelRates.id });
      id = inserted.id;
    } catch (err) {
      if (isPersonnelRateUniqueViolation(err)) throw new ConflictError('نرخ اختصاصی این پرسنل هم‌زمان ذخیره شد؛ صفحه را دوباره بارگذاری کنید.', { personnelId, taskId }, 'PIECEWORK_RATE_CONCURRENT');
      throw err;
    }
  }

  const reqUser = (actor.req as { user?: { id?: number; username?: string } } | undefined)?.user;
  const userId = actor.userId ?? reqUser?.id;
  const username = actor.username || reqUser?.username || 'سیستم';
  const oldRate = current ? current.customRate : null;
  await tx.insert(pieceworkTaskRateHistory).values({
    taskId,
    taskCode: task.code || '',
    taskTitle: task.title,
    personnelId,
    oldRate: money(oldRate ?? task.defaultRate ?? 0),
    newRate,
    changeType: current ? 'personnel_rate_change' : 'personnel_rate_create',
    reason: `نرخ اختصاصی ${person.fullName}`,
    changedByUserId: userId ?? null,
    changedByUsername: username,
    effectiveDate: await businessTodayIsoDate(),
  });
  await logActivity({
    tx,
    req: actor.req,
    userId,
    username,
    action: current ? 'UPDATE' : 'CREATE',
    entity: PERSONNEL_RATE_AUDIT_ENTITY,
    entityId: id,
    description: current
      ? `تغییر نرخ اختصاصی ${person.fullName} برای «${task.title}» از ${toPersianDigits(fin(current.customRate).toString())} به ${toPersianDigits(newRate.toString())}`
      : `تعیین نرخ اختصاصی ${person.fullName} برای «${task.title}»: ${toPersianDigits(newRate.toString())}`,
    details: {
      personnelId,
      personnelName: person.fullName,
      taskId,
      taskTitle: task.title,
      before: current ? { customRate: current.customRate } : null,
      after: { customRate: newRate },
      changes: { customRate: { before: oldRate, after: newRate } },
    },
  });
  return { id, changed: true };
}

export interface DuplicatePersonnelRateRow {
  personnelId: number;
  personnelName: string;
  taskId: number;
  taskTitle: string;
  rateIds: number[];
  rates: string[];
}

/** بیش از یک نرخ اختصاصی فعال برای یک پرسنل و یک عنوان کار (داده پیش از مهاجرت 0076) */
export async function findDuplicatePersonnelRates(db: DbExecutor = orm): Promise<DuplicatePersonnelRateRow[]> {
  const rows = await db.select({
    id: pieceworkPersonnelRates.id,
    personnelId: pieceworkPersonnelRates.personnelId,
    taskId: pieceworkPersonnelRates.taskId,
    customRate: pieceworkPersonnelRates.customRate,
    personnelName: personnel.fullName,
    taskTitle: pieceworkTasks.title,
  })
    .from(pieceworkPersonnelRates)
    .leftJoin(personnel, eq(personnel.id, pieceworkPersonnelRates.personnelId))
    .leftJoin(pieceworkTasks, eq(pieceworkTasks.id, pieceworkPersonnelRates.taskId))
    .where(and(eq(pieceworkPersonnelRates.isDeleted, 0), sql`(${pieceworkPersonnelRates.personnelId}, ${pieceworkPersonnelRates.taskId}) IN (
      SELECT r.personnel_id, r.task_id FROM piecework_personnel_rates r WHERE r.is_deleted = 0
      GROUP BY r.personnel_id, r.task_id HAVING COUNT(*) > 1
    )`))
    .orderBy(asc(pieceworkPersonnelRates.personnelId), asc(pieceworkPersonnelRates.taskId), asc(pieceworkPersonnelRates.id));
  const groups = new Map<string, DuplicatePersonnelRateRow>();
  for (const r of rows) {
    const key = `${r.personnelId}|${r.taskId}`;
    const group = groups.get(key) ?? { personnelId: r.personnelId, personnelName: r.personnelName ?? '', taskId: r.taskId, taskTitle: r.taskTitle ?? '', rateIds: [], rates: [] };
    group.rateIds.push(r.id);
    group.rates.push(fin(r.customRate).toString());
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function hasPersonnelRateUniqueIndex(db: DbExecutor = orm): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(${PERSONNEL_RATE_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildPersonnelRateHealthTest(duplicates: DuplicatePersonnelRateRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const count = duplicates.length;
  return {
    id: 'piecework_personnel_rate_uniqueness',
    category: 'system',
    title: 'یکتایی نرخ اختصاصی پرسنل',
    description: 'هر پرسنل برای هر عنوان کار حداکثر یک نرخ اختصاصی فعال دارد و پایگاه‌داده با ایندکس یکتا از نرخ دوم جلوگیری می‌کند. پیش از نسخه ۹.۰.۲۴۰ ذخیره‌های هم‌زمان دو نرخ فعال می‌ساختند؛ این ردیف‌ها خودکار حذف نمی‌شوند',
    status: count > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, count * 2),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} پرسنل و عنوان کار بیش از یک نرخ اختصاصی فعال دارند و قید یکتایی در پایگاه‌داده اعمال نشده است؛ کارکرد و صفحه نرخ‌ها تازه‌ترین نرخ را می‌خوانند. نرخ درست را در صفحه نرخ‌ها دوباره ذخیره کنید.`
      : (uniqueIndexPresent
        ? 'هیچ پرسنلی برای یک عنوان کار بیش از یک نرخ اختصاصی فعال ندارد و پایگاه‌داده از نرخ دوم جلوگیری می‌کند.'
        : 'هیچ پرسنلی برای یک عنوان کار بیش از یک نرخ اختصاصی فعال ندارد اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map(d => ({
      id: d.rateIds[d.rateIds.length - 1],
      code: `پرسنل #${toPersianDigits(d.personnelId)}`,
      title: d.personnelName || `پرسنل #${toPersianDigits(d.personnelId)}`,
      subtitle: `عنوان کار: ${d.taskTitle || `#${toPersianDigits(d.taskId)}`}`,
      details: `نرخ‌های فعال: ${d.rates.map(r => toPersianDigits(r)).join('، ')}؛ کارکرد تازه‌ترین را می‌گیرد (TD-809).`,
    })),
    metrics: { duplicatePersonnelRates: count, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
