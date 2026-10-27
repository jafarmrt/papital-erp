import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

const SHOWN_RECEIPTS = 5;

/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): once a project delivered goods, its materials' cost is in their cost, since each
 * production receipt took its share of the project's 1402. Releasing a material allocation or voiding a project remittance
 * would take that cost out of 1402 a second time and leave it below zero, so both are refused (409
 * `PROJECT_MATERIALS_DELIVERED`) while the project has a live final production receipt; voiding the receipts first brings
 * their share back to 1402. Before, both were allowed and 1402 went negative. The caller holds the project row lock, which
 * every delivery takes too.
 */
export async function assertProjectMaterialsNotDelivered(tx: DbExecutor, projectId: number, what: 'allocation' | 'remittance'): Promise<void> {
  const receipts = await tx.select({ refNumber: documents.refNumber })
    .from(documents)
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.type, 'production_receipt'),
      eq(documents.status, 'final'),
      eq(documents.isDeleted, 0),
    ))
    .orderBy(asc(documents.id));
  if (receipts.length === 0) return;
  const refs = receipts.slice(0, SHOWN_RECEIPTS).map(r => `«${toPersianDigits(r.refNumber)}»`).join('، ');
  const subject = what === 'allocation' ? 'این تخصیص مواد آزاد' : 'این حوالهٔ پروژه ابطال';
  throw new ConflictError(
    `${subject} نمی‌شود: پروژه محصول تحویل داده و بهای مواد آن در رسید تولید ${refs}${receipts.length > SHOWN_RECEIPTS ? '، …' : ''} آمده است. ` +
    'اول رسیدهای تولید پروژه را ابطال کنید.',
    { productionReceipts: receipts.map(r => r.refNumber) },
    'PROJECT_MATERIALS_DELIVERED',
  );
}
