import { eq } from 'drizzle-orm';
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
  const active = await tx
    .select({ code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.isActive, 1));

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
 * TD-114: هر ورودی (کد، نام یا خالی) را به کد یک انبار فعال تبدیل می‌کند، یا خطای ۴۲۲ (ValidationError) می‌دهد.
 */
export async function resolveWarehouseCode(tx: DbClient, raw: unknown): Promise<string> {
  const resolver = await createWarehouseResolver(tx);
  return resolver(raw);
}

