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


export interface LedgerWarehouseRef { id: number; code: string; name: string; isActive: number | null }

/**
 * v9.0.108 (TD-482 / B06-03): the Kardex ledger reads '' and 'default' as the default warehouse, so neither may be a
 * warehouse code; a warehouse that already has one is only listed by the financial health check.
 */
export const LEDGER_RESERVED_WAREHOUSE_CODES: ReadonlySet<string> = new Set(['', 'default']);

export function isLedgerReservedWarehouseCode(code: unknown): boolean {
  return LEDGER_RESERVED_WAREHOUSE_CODES.has(String(code ?? '').trim().toLowerCase());
}

/**
 * v7.0.33 (TD-200) / v7.0.45 (P2-1): نگاشت محل ثبت‌شده در کاردکس (یا کلید JSONB قدیمی) به انبار — روی همه انبارها،
 * از جمله غیرفعال، چون تاریخچه ممکن است به انباری اشاره کند که بعداً غیرفعال شده است.
 * '' و 'default' = انبار پیش‌فرض (فعال با کمترین شناسه)؛ سپس کد و سپس نام (بدون حساسیت به حروف)؛ در غیر این صورت null.
 * همین قاعده در تطبیق موجودی انبارها، بازسازی کاردکس و تابع SQL مهاجرت 0020 استفاده می‌شود.
 */
export function createLedgerLocationResolver(all: LedgerWarehouseRef[]): (raw: unknown) => LedgerWarehouseRef | null {
  const sorted = [...all].sort((a, b) => a.id - b.id);
  const defaultWh = sorted.find(w => w.isActive === 1) ?? sorted[0] ?? null;
  const byCode = new Map<string, LedgerWarehouseRef>();
  for (const w of sorted) {
    const key = w.code.trim().toLowerCase();
    if (!byCode.has(key)) byCode.set(key, w);
  }
  const byName = new Map<string, LedgerWarehouseRef>();
  for (const w of sorted) {
    const key = (w.name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, w);
  }
  return (raw: unknown): LedgerWarehouseRef | null => {
    const key = String(raw ?? '').trim().toLowerCase();
    // ردیف‌های قدیمی بدون انبار و ردیف‌های معکوس با برچسب 'default' به انبار پیش‌فرض تعلق دارند
    if (!key || key === 'default') return defaultWh;
    return byCode.get(key) ?? byName.get(key) ?? null;
  };
}
