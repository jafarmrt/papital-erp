import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { crmLeads, customers } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { toLatinDigits } from '../../lib/numericInput.js';

/**
 * v9.0.17 (TD-426): پرونده فروش و طرف حساب یک اقدام CRM پیش از ثبت سنجیده می‌شوند. ستون‌ها FK پایگاه‌داده ندارند و پیش‌تر
 * شناسه ناموجود بی بررسی درج می‌شد: اقدامی با دو والد ناموجود ۲۰۱ می‌گرفت و در آمار و یادآور سررسید شمرده می‌شد.
 */

export interface ActivityParents {
  leadId: number | null;
  customerId: number | null;
}

function optionalId(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  const text = toLatinDigits(String(value)).trim();
  if (text === '') return null;
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new ValidationError(`شناسه ${label} باید عدد صحیح مثبت باشد (مقدار دریافتی: ${String(value)})`);
  }
  return Number(text);
}

export async function resolveActivityParents(executor: DbExecutor, input: { leadId?: unknown; customerId?: unknown }): Promise<ActivityParents> {
  const leadId = optionalId(input.leadId, 'پرونده فروش');
  const customerId = optionalId(input.customerId, 'طرف حساب');

  if (leadId !== null) {
    const [lead] = await executor.select({ id: crmLeads.id }).from(crmLeads)
      .where(and(eq(crmLeads.id, leadId), eq(crmLeads.isDeleted, 0)));
    if (!lead) throw new ValidationError(`پرونده فروش ${leadId} یافت نشد یا حذف شده است؛ اقدام ثبت نشد.`);
  }
  if (customerId !== null) {
    const [customer] = await executor.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.isDeleted, 0)));
    if (!customer) throw new ValidationError(`طرف حساب ${customerId} یافت نشد یا حذف شده است؛ اقدام ثبت نشد.`);
  }
  return { leadId, customerId };
}
