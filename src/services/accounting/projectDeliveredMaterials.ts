import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { formatPersianNumber, toPersianDigits } from '../../utils/persianNumber.js';
import { projectWipBalances } from './projectWipBalance.js';

const SHOWN_RECEIPTS = 5;

/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): each production receipt of a project takes its share of the project's 1402, so a
 * release of a material allocation or a void of a project remittance may take out of 1402 only what is still there. Called
 * after the release or void wrote its voucher, in the same transaction: when the project's 1402 is now below zero, the
 * receipts already took that cost and the change is refused (409 `PROJECT_MATERIALS_DELIVERED`, naming them); voiding
 * them first brings their share back. A cost no receipt took (an allocation or remittance after the last delivery, the
 * unused materials of a cancelled project) is still released or voided (review of S2). Before this phase both were always
 * allowed and 1402 went negative. The caller holds the project row lock, which every delivery takes too.
 */
export async function assertProjectWipStaysCovered(tx: DbExecutor, projectId: number, what: 'allocation' | 'remittance'): Promise<void> {
  const balance = fin((await projectWipBalances(tx, [projectId])).get(projectId) ?? 0);
  if (!balance.add(VOUCHER_BALANCE_TOLERANCE).isNegative()) return;
  const receipts = await tx.select({ refNumber: documents.refNumber })
    .from(documents)
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.type, 'production_receipt'),
      eq(documents.status, 'final'),
      eq(documents.isDeleted, 0),
    ))
    .orderBy(asc(documents.id));
  const refs = receipts.slice(0, SHOWN_RECEIPTS).map(r => `«${toPersianDigits(r.refNumber)}»`).join('، ');
  const subject = what === 'allocation' ? 'این تخصیص مواد آزاد' : 'این حوالهٔ پروژه ابطال';
  const takenBy = receipts.length > 0
    ? ` و بهای آن در رسید تولید ${refs}${receipts.length > SHOWN_RECEIPTS ? '، …' : ''} آمده است. اول رسیدهای تولید پروژه را ابطال کنید.`
    : '.';
  throw new ConflictError(
    `${subject} نمی‌شود: ماندهٔ کالای در جریان ساخت پروژه با آن ${formatPersianNumber(balance.abs().toNumber())} ریال زیر صفر می‌رود${takenBy}`,
    { wipBalanceAfter: balance.toNumber(), productionReceipts: receipts.map(r => r.refNumber) },
    'PROJECT_MATERIALS_DELIVERED',
  );
}
