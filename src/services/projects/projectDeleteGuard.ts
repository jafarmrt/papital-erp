import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import { assertNoOpenAllocations } from './projectOpenAllocations.js';
import { projectWipBalances } from './projectWipBalance.js';

const LISTED = 5;

/**
 * v10.0.24 (TD-922، تصمیم ت۴ ب فاز ۵): پروژه‌ای که تخصیص باز (TD-412)، سند زنده (هر نوع و وضعیت) یا مانده کالای در
 * جریان ساخت (۱۴۰۲) دارد حذف نمی‌شود. پیش‌تر نگهبان فقط تخصیص باز را می‌دید و مانده ۱۴۰۲ روی پروژه حذف‌شده می‌ماند.
 * زیر قفل ردیف پروژه صدا زده می‌شود.
 */
export async function assertProjectDeletable(tx: DbExecutor, project: { id: number; projectCode: string }): Promise<void> {
  await assertNoOpenAllocations(tx, project, 'حذف نمی‌شود');
  const live = await tx.select({ refNumber: documents.refNumber })
    .from(documents)
    .where(and(eq(documents.projectId, project.id), eq(documents.isDeleted, 0)))
    .orderBy(asc(documents.id));
  const wip = (await projectWipBalances(tx, [project.id])).get(project.id);
  const reasons: string[] = [];
  if (wip) {
    const side = fin(wip).isNegative() ? 'بستانکار' : 'بدهکار';
    reasons.push(`مانده کالای در جریان ساخت ${formatPersianPrice(fin(wip).abs().toString(), 'IRR', 0)} ${side}`);
  }
  if (live.length > 0) {
    const shown = live.slice(0, LISTED).map(d => String(d.refNumber ?? '')).join('، ');
    reasons.push(`سند انبار یا فروش ${shown}${live.length > LISTED ? ` و ${toPersianDigits(live.length - LISTED)} سند دیگر` : ''}`);
  }
  if (reasons.length === 0) return;
  throw new ConflictError(
    `پروژه «${project.projectCode}» حذف نمی‌شود: ${reasons.join('؛ ')}. سندها را باطل کنید و مانده را با سند اصلاحی ببندید، یا پروژه را «لغو» کنید.`,
    { wipBalance: wip ?? null, documentRefs: live.map(d => String(d.refNumber ?? '')) },
    'PROJECT_HAS_LEDGER_ITEMS',
  );
}
