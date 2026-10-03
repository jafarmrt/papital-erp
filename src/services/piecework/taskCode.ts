import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
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
