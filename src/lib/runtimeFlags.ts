import { orm } from '../db/drizzle.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * V1.1.1 — Runtime Feature Flags (فلگ‌های سیستمی قابل کنترل از UI)
 * ================================================================
 * تنها فلگ‌هایی که (الف) در زمان درخواست ارزیابی می‌شوند و (ب) آثار
 * امنیتی/تخریبی دائمی ندارند، از این مسیر کنترل می‌شوند. متغیرهای
 * boot-time (NODE_ENV، DATABASE_URL، JWT_SECRET، تنظیمات pool و ...)
 * و گارد تخریب داده (ERP_ALLOW_TEST_CLEANUP) عمداً خارج از این
 * سازوکار و فقط از فایل .env قابل تنظیم‌اند.
 *
 * مقدار مؤثر هر فلگ با این اولویت خوانده می‌شود:
 *   1) مقدار ذخیره‌شده در appSettings (کنترل مدیر از تب پیکربندی سیستمی)
 *   2) متغیر محیطی هم‌نام (سازگاری با استقرارهای موجود)
 *   3) مقدار پیش‌فرض امن (false)
 * کش ۶۰ ثانیه‌ای مشابه businessClock است و پس از ذخیره تنظیمات باطل می‌شود.
 */

export const RUNTIME_TEST_ENDPOINTS_KEY = 'runtime_enable_test_endpoints';

const FLAG_TTL_MS = 60 * 1000;

let cachedFlag: { value: boolean; expiresAt: number } | null = null;

/** منبع مقدار مؤثر آخرین خوانش — برای نمایش در GET /system/env */
export type RuntimeFlagSource = 'db' | 'env' | 'default';
let lastFlagSource: RuntimeFlagSource = 'default';

function envFlagValue(): string | undefined {
  const raw = String(process.env.ENABLE_TEST_ENDPOINTS || '').trim().toLowerCase();
  return raw === 'true' || raw === 'false' ? raw : undefined;
}

export async function isTestEndpointsEnabled(): Promise<boolean> {
  if (cachedFlag && Date.now() < cachedFlag.expiresAt) return cachedFlag.value;
  let effective = false;
  let source: RuntimeFlagSource = 'default';
  try {
    const [row] = await orm
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, RUNTIME_TEST_ENDPOINTS_KEY))
      .limit(1);
    const dbVal = String(row?.value || '').trim().toLowerCase();
    if (dbVal === 'true' || dbVal === 'false') {
      effective = dbVal === 'true';
      source = 'db';
    } else if (envFlagValue() !== undefined) {
      effective = envFlagValue() === 'true';
      source = 'env';
    }
  } catch {
    // DB unreachable — به متغیر محیطی/پیش‌فرض امن می‌افتیم
    if (envFlagValue() !== undefined) {
      effective = envFlagValue() === 'true';
      source = 'env';
    }
  }
  cachedFlag = { value: effective, expiresAt: Date.now() + FLAG_TTL_MS };
  lastFlagSource = source;
  return effective;
}

/** منبع مقدار مؤثر — فقط معتبر بلافاصله پس از یک فراخوانی isTestEndpointsEnabled */
export function getTestEndpointsSource(): RuntimeFlagSource {
  return lastFlagSource;
}

/** ابطال کش فلگ‌ها پس از تغییر تنظیمات توسط مدیر */
export function invalidateRuntimeFlagsCache(): void {
  cachedFlag = null;
}
