import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';

/**
 * v10.0.28 (TD-921، تصمیم ت۱۰ فاز ۵): سند انبار یا فروش و کارکرد تازه روی پروژه لغوشده پذیرفته نمی‌شود، مثل تخصیص مواد
 * (TD-759). پیش‌تر تخصیص ۴۲۲ می‌گرفت ولی حواله ۲۰۰ می‌گرفت و ۱۴۰۲ پروژه لغوشده را بدهکار می‌کرد، و کارکرد ۲۰۱.
 * ابطال سند یا کارکرد پیشین آزاد است. `what` نام آنچه رد می‌شود است («سند»، «کارکرد»).
 */
export async function assertProjectNotCancelled(tx: DbExecutor, projectId: number, what: string): Promise<void> {
  const [project] = await tx.select({ projectCode: productionProjects.projectCode, status: productionProjects.status })
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (project?.status !== 'cancelled') return;
  throw new ValidationError(
    `پروژه «${project.projectCode}» لغو شده است و ${what} تازه روی آن ثبت نمی‌شود؛ پروژه دیگری انتخاب کنید یا پروژه را از لغو بیرون آورید.`,
    { projectId, status: project.status }, 'PROJECT_CANCELLED',
  );
}
