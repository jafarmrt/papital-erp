import { eq } from 'drizzle-orm';
import { warehouses } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import type { DbExecutor } from '../../db/drizzle.js';

export type DbClient = DbExecutor;

/**
 * TD-114: هر ورودی (کد، نام یا خالی) را به کد یک انبار فعال تبدیل می‌کند، یا خطای ۴۲۲ (ValidationError) می‌دهد.
 */
export async function resolveWarehouseCode(tx: DbClient, raw: unknown): Promise<string> {
  const input = String(raw ?? '').trim();
  const active = await tx
    .select({ code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.isActive, 1));

  if (active.length === 0) {
    throw new ValidationError('هیچ انبار فعالی تعریف نشده است. از تنظیمات ← مدیریت انبارها یک انبار بسازید.');
  }

  // ورودی خالی: به کد اولین انبار فعال نگاشت می‌شود
  if (!input) return active[0].code;

  // مطابقت مستقیم با کد انبار
  const byCode = active.find(w => w.code.toLowerCase() === input.toLowerCase());
  if (byCode) return byCode.code;

  // مطابقت با نام انبار (مانند «انبار اصلی» یا «انبار مرکزی»)
  const byName = active.find(w => (w.name || '').trim().toLowerCase() === input.toLowerCase());
  if (byName) {
    logger.warn({ message: `[WarehouseResolver] name used instead of code: "${input}" -> "${byName.code}"` });
    return byName.code;
  }

  // در صورتی که کد یا نام در میان انبارهای فعال یافت نشود
  throw new ValidationError(`انبار «${input}» تعریف نشده یا غیرفعال است.`);
}
