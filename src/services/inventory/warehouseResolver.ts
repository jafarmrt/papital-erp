import { asc, eq } from 'drizzle-orm';
import { warehouses } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import type { DbExecutor } from '../../db/drizzle.js';

export type DbClient = DbExecutor;

export type WarehouseResolverFn = (raw: unknown) => string;

/**
 * TD-164: ایجاد حل‌کننده دسته‌ای و کش‌شده کد انبار برای جلوگیری از کوری‌های تکراری N+1 در حلقه‌های اسناد
 */
export async function createWarehouseResolver(tx: DbClient): Promise<WarehouseResolverFn> {
  // v7.0.36 (audit P2-3): انبار پیش‌فرض = انبار فعال با کمترین شناسه؛ بدون ORDER BY ترتیب ردیف‌ها در PostgreSQL
  // تضمین‌شده نیست (پس از UPDATE/VACUUM تغییر می‌کند) و حرکات بدون انبار مشخص به انبارهای متفاوت می‌رفتند.
  const active = await tx
    .select({ code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.isActive, 1))
    .orderBy(asc(warehouses.id));

  if (active.length === 0) {
    throw new ValidationError('هیچ انبار فعالی تعریف نشده است. از تنظیمات ← مدیریت انبارها یک انبار بسازید.');
  }

  const defaultCode = active[0].code;
  const codeLookup = new Map<string, string>();
  const nameLookup = new Map<string, string>();

  for (const w of active) {
    codeLookup.set(w.code.toLowerCase(), w.code);
    if (w.name) {
      nameLookup.set(w.name.trim().toLowerCase(), w.code);
    }
  }

  return (raw: unknown): string => {
    const input = String(raw ?? '').trim();
    if (!input) return defaultCode;

    const lower = input.toLowerCase();
    const byCode = codeLookup.get(lower);
    if (byCode) return byCode;

    const byName = nameLookup.get(lower);
    if (byName) {
      logger.warn({ message: `[WarehouseResolver] name used instead of code: "${input}" -> "${byName}"` });
      return byName;
    }

    throw new ValidationError(`انبار «${input}» تعریف نشده یا غیرفعال است.`);
  };
}

/**
 * v7.0.36 (audit P2-3): کد انبار پیش‌فرض سامانه — انبار فعال با کمترین شناسه — یا null اگر انبار فعالی نباشد.
 * هر جا «انبار پیش‌فرض» لازم است از همین تابع (یا ترتیب asc(warehouses.id)) استفاده شود.
 */
export async function getDefaultWarehouseCode(tx: DbClient): Promise<string | null> {
  const [first] = await tx
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(eq(warehouses.isActive, 1))
    .orderBy(asc(warehouses.id))
    .limit(1);
  return first?.code ?? null;
}

/**
 * TD-114: هر ورودی (کد، نام یا خالی) را به کد یک انبار فعال تبدیل می‌کند، یا خطای ۴۲۲ (ValidationError) می‌دهد.
 */
export async function resolveWarehouseCode(tx: DbClient, raw: unknown): Promise<string> {
  const resolver = await createWarehouseResolver(tx);
  return resolver(raw);
}

