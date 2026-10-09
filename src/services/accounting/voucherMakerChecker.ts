import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { ForbiddenError } from '../../errors/customErrors.js';
import { voucherSourceKind } from './voucherSource.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.0.21 (TD-965، OBS-R1-44، طرح حقوق ت۱۰ و ت۳ «الف»): ثبت‌کننده سند دستی آن را تأیید نمی‌کند. «ثبت‌کننده» کسی است که
 * سند را ثبت کرده (`created_by_id`) یا آخرین بار ویرایش کرده (`updated_by_id`)؛ «تأیید» یعنی سند از پیش‌نویس به تأییدشده
 * یا دائم برود. سند خودکار (منشأدار: فاکتور، خزانه، چک، فیش، تخصیص مواد) و سند بستن سال بیرون است، چون سازنده‌اش کاربر
 * عملیات است، نه حسابدار. مدیر سیستم مستثناست و نام او در ردیف ممیزی همان تأیید می‌آید.
 */
export const VOUCHER_MAKER_CANNOT_APPROVE = 'VOUCHER_MAKER_CANNOT_APPROVE';

export interface MakerFacts {
  id: number;
  voucherNumber: number | string | null;
  status: string | null;
  createdById: number | null;
  updatedById?: number | null;
  sourceFiscalYear?: number | null;
}

/** پیام ردِ تأیید سند توسط ثبت‌کننده‌اش، یا null وقتی قاعده این تأیید را نمی‌گیرد */
export async function makerApprovalRefusal(
  tx: DbExecutor, voucher: MakerFacts, targetStatus: string, actorId: number | undefined | null,
): Promise<string | null> {
  if (voucher.status !== 'draft' || (targetStatus !== 'approved' && targetStatus !== 'permanent')) return null;
  if (!actorId) return null;
  if (actorId !== voucher.createdById && actorId !== (voucher.updatedById ?? null)) return null;
  if (voucher.sourceFiscalYear !== null && voucher.sourceFiscalYear !== undefined) return null;
  if (await voucherSourceKind(tx, voucher.id)) return null;
  const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId));
  if (actor?.role === SYSTEM_ADMIN_ROLE) return null;
  return `سند شماره ${toPersianDigits(String(voucher.voucherNumber ?? voucher.id))} را خودتان ثبت یا ویرایش کرده‌اید؛ تأیید آن با کاربر دیگری است.`;
}

export async function assertNotApprovedByMaker(
  tx: DbExecutor, voucher: MakerFacts, targetStatus: string, actorId: number | undefined | null,
): Promise<void> {
  const refusal = await makerApprovalRefusal(tx, voucher, targetStatus, actorId);
  if (refusal) throw new ForbiddenError(refusal, { voucherId: voucher.id }, VOUCHER_MAKER_CANNOT_APPROVE);
}

/** سند دستی که با وضعیت «تأییدشده» ثبت شود، ثبت‌کننده‌اش آن را تأیید کرده است؛ فقط مدیر سیستم چنین ثبتی دارد */
export async function assertManualApprovedCreateAllowed(tx: DbExecutor, actorId: number | undefined | null): Promise<void> {
  if (actorId) {
    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId));
    if (actor?.role === SYSTEM_ADMIN_ROLE) return;
  }
  throw new ForbiddenError(
    'سند دستی پیش‌نویس ثبت می‌شود و تأیید آن با کاربر دیگری است؛ سند را بی وضعیت «تأییدشده» ثبت کنید.',
    undefined, VOUCHER_MAKER_CANNOT_APPROVE,
  );
}
