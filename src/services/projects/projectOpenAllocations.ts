import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { projectBomAllocations } from '../../db/schema.js';
import { BusinessLogicError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v8.0.121 (TD-412، تصمیم مالک محصول — گزینه الف): پروژه‌ای که تخصیص مواد باز دارد حذف نمی‌شود تا تخصیص‌ها آزاد شوند.
 * پیش‌تر بهای مواد تخصیص‌یافته در کالای در جریان ساخت (۱۴۰۲) زیر تفصیلی پروژه حذف‌شده می‌ماند و دیگر از صفحه پروژه آزاد
 * نمی‌شد. v9.0.410 (TD-759، تصمیم ت۹ الف): لغو پروژه هم همین قاعده را دارد. ردیف پروژه پیش‌تر قفل شده است؛ تخصیص هم آن را
 * قفل می‌کند، پس حذف یا لغو و تخصیص هم‌زمان پشت هم‌اند.
 */
export async function assertNoOpenAllocations(tx: DbExecutor, project: { id: number; projectCode: string }, refusal: 'حذف نمی‌شود' | 'لغو نمی‌شود'): Promise<void> {
  const open = await tx.select({ itemCode: projectBomAllocations.itemCode, itemName: projectBomAllocations.itemName, quantity: projectBomAllocations.quantity, unit: projectBomAllocations.unit })
    .from(projectBomAllocations)
    .where(and(eq(projectBomAllocations.projectId, project.id), eq(projectBomAllocations.status, 'allocated'), eq(projectBomAllocations.isDeleted, 0)))
    .orderBy(asc(projectBomAllocations.id));
  if (open.length === 0) return;
  const list = open.slice(0, 5).map(a => `«${a.itemName}» (${a.itemCode}) ${a.quantity} ${a.unit || 'عدد'}`).join('، ');
  throw new BusinessLogicError(
    `پروژه «${project.projectCode}» ${toPersianDigits(open.length)} تخصیص مواد باز دارد (${list}${open.length > 5 ? '، …' : ''}) و ${refusal}؛ ابتدا تخصیص‌ها را از زبانه مواد پروژه آزاد کنید.`,
    { code: 'PROJECT_HAS_OPEN_ALLOCATIONS', openAllocations: open.length }
  );
}
