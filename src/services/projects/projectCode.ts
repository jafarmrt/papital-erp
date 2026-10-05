import { and, eq, like, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentRefCounters, productionProjects } from '../../db/schema.js';
import { businessFiscalYear } from '../../lib/businessClock.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';

/**
 * v8.0.80 (TD-350): کد خودکار پروژه (PRJ-<سال>-<شماره>) از شمارنده اتمی سال جاری در `document_ref_counters`
 * (ردیف `project`، سال شمسی امروز) ساخته می‌شود (AGENTS.md §1.6). پیش‌تر شماره `COUNT(*) + 1` همه پروژه‌ها بود: دو پروژه
 * هم‌زمان یک کد می‌گرفتند و یکی با خطای یکتایی `project_code` رد می‌شد. کد دستی هم زیر قفل همان ردیف سنجیده می‌شود،
 * پس دو ثبت هم‌زمان یک کد هر دو پذیرفته نمی‌شوند (دومی پسوند «-۱» می‌گیرد).
 */

const COUNTER_KEY = 'project';

function autoCode(year: number, n: number): string {
  return `PRJ-${year}-${String(n).padStart(3, '0')}`;
}

/** بزرگ‌ترین شماره کدهای PRJ-<سال>-<شماره> همه پروژه‌ها (حذف‌شده هم، تا کد دوباره به کار نرود) */
async function maxAutoNumber(db: DbExecutor, year: number): Promise<number> {
  const pattern = new RegExp(`^PRJ-${year}-(\\d+)$`);
  const rows = await db.select({ code: productionProjects.projectCode }).from(productionProjects)
    .where(like(productionProjects.projectCode, startsWithLikePattern(`PRJ-${year}-`)));
  let max = 0;
  for (const row of rows) {
    const match = String(row.code || '').trim().match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/** ردیف شمارنده سال را FOR UPDATE قفل می‌کند (در اولین استفاده با بیشینه کدهای موجود آن سال ساخته می‌شود) */
async function lockCounter(tx: DbExecutor, year: number): Promise<number> {
  const where = and(eq(documentRefCounters.docType, COUNTER_KEY), eq(documentRefCounters.fiscalYear, year));
  let [row] = await tx.select({ last: documentRefCounters.lastRefNumber }).from(documentRefCounters).where(where).for('update');
  if (!row) {
    const seed = await maxAutoNumber(tx, year);
    await tx.insert(documentRefCounters).values({ docType: COUNTER_KEY, fiscalYear: year, lastRefNumber: seed }).onConflictDoNothing();
    [row] = await tx.select({ last: documentRefCounters.lastRefNumber }).from(documentRefCounters).where(where).for('update');
  }
  return row?.last ?? 0;
}

async function codeTaken(db: DbExecutor, code: string, exceptId?: number): Promise<boolean> {
  const conditions = [sql`${productionProjects.projectCode} = ${String(code)}::text`];
  if (exceptId) conditions.push(ne(productionProjects.id, exceptId));
  const rows = await db.select({ id: productionProjects.id }).from(productionProjects).where(and(...conditions)).limit(1);
  return rows.length > 0;
}

/**
 * کد پروژه را در تراکنش فراخواننده می‌دهد. بی کد درخواستی، شماره بعدی شمارنده سال (کدی که دستی گرفته شده رد می‌شود)؛
 * با کد درخواستی، همان کد یا اگر گرفته شده «کد-۱»، «کد-۲»… . هر دو حالت زیر قفل ردیف شمارنده سال اجرا می‌شوند.
 */
export async function assignProjectCode(tx: DbExecutor, requested?: string, exceptId?: number): Promise<string> {
  const year = await businessFiscalYear();
  const last = await lockCounter(tx, year);
  const custom = requested ? String(requested).trim() : '';

  if (custom) {
    let code = custom;
    for (let suffix = 1; await codeTaken(tx, code, exceptId); suffix++) code = `${custom}-${suffix}`;
    return code;
  }

  let next = last + 1;
  while (await codeTaken(tx, autoCode(year, next), exceptId)) next++;
  await tx.update(documentRefCounters).set({ lastRefNumber: next })
    .where(and(eq(documentRefCounters.docType, COUNTER_KEY), eq(documentRefCounters.fiscalYear, year)));
  return autoCode(year, next);
}
