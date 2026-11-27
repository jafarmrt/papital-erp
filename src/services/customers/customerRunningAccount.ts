import { and, eq, ne } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { customers, personnel } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { isRunningAccountKind, RUNNING_ACCOUNT_LABELS, type PartyRunningAccount } from '../../lib/accounting/runningAccount.js';

/**
 * v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.1): a party's link to a colleague or
 * partner of the personnel and the running account its invoices go to. Both are set together or cleared together; the
 * colleague is live; a colleague has at most one live linked party (the unique index is the last guard); a supplier only
 * buys from the shop, so it takes no link. A change applies to invoices finalized afterwards: issued ones keep their stamp.
 */
export interface PartyRunningAccountLink {
  personnelId: number | null;
  runningAccount: PartyRunningAccount;
}

export async function resolvePartyRunningAccount(
  executor: DbExecutor,
  input: { personnelId?: number | null; runningAccount?: string | null },
  previous: PartyRunningAccountLink | null,
  context: { partyType: string; customerId?: number },
): Promise<PartyRunningAccountLink> {
  if (input.personnelId === undefined && input.runningAccount === undefined) {
    return previous ?? { personnelId: null, runningAccount: '' };
  }
  const personnelId = input.personnelId === undefined ? previous?.personnelId ?? null : input.personnelId;
  const kind = input.runningAccount === undefined ? previous?.runningAccount ?? '' : (input.runningAccount ?? '');
  if (!personnelId && !kind) return { personnelId: null, runningAccount: '' };
  if (!personnelId || !isRunningAccountKind(kind)) {
    throw new ValidationError('برای وصل کردن طرف حساب به همکار یا شریک، هم همکار را انتخاب کنید و هم حساب جاری او را (همکار یا شرکا).', undefined, 'PARTY_RUNNING_ACCOUNT_INCOMPLETE');
  }
  if (context.partyType === 'supplier') {
    throw new ValidationError('تأمین‌کننده فقط به کارگاه می‌فروشد و به حساب جاری همکار وصل نمی‌شود؛ نوع طرف حساب را «مشتری» یا «هر دو» بگذارید.', undefined, 'PARTY_RUNNING_ACCOUNT_SUPPLIER');
  }
  const [person] = await executor.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel)
    .where(and(eq(personnel.id, personnelId), eq(personnel.isDeleted, 0))).for('share');
  if (!person) throw new ValidationError('همکار انتخاب‌شده در پرسنل پیدا نشد یا حذف شده است.', { personnelId }, 'PARTY_RUNNING_ACCOUNT_PERSONNEL');
  const [other] = await executor.select({ id: customers.id, name: customers.name }).from(customers)
    .where(and(eq(customers.personnelId, personnelId), eq(customers.isDeleted, 0), ...(context.customerId ? [ne(customers.id, context.customerId)] : [])));
  if (other) {
    throw new ConflictError(`${person.fullName} پیش‌تر به طرف حساب «${other.name}» وصل است؛ هر همکار یک طرف حساب دارد.`, { customerId: other.id }, 'PARTY_RUNNING_ACCOUNT_TAKEN');
  }
  return { personnelId, runningAccount: kind };
}

export const partyRunningAccountLabel = (kind: PartyRunningAccount): string => (kind ? RUNNING_ACCOUNT_LABELS[kind] : '');
