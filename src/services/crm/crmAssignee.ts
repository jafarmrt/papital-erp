import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { BadRequestError, NotFoundError } from '../../errors/customErrors.js';

// V10-4.1: resolve مسئول از پرسنل — id معتبر => snapshot نام؛ نام بدون id => best-effort اتصال
export async function resolveAssignee(input: { name?: string | null; personnelId?: number | string | null }, db: DbExecutor): Promise<{ name: string; id: number | null }> {
  const nameStr = String(input.name ?? '').trim();

  if (input.personnelId !== undefined && input.personnelId !== null && String(input.personnelId).trim() !== '') {
    const pid = Number(input.personnelId);
    if (Number.isNaN(pid) || pid <= 0) {
      throw new BadRequestError('شناسه فروشنده/مسئول نامعتبر است');
    }
    const [p] = await db.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, pid));
    if (!p) {
      throw new NotFoundError('پرسنل انتخاب‌شده یافت نشد');
    }
    return { name: p.fullName, id: p.id };
  }

  if (nameStr) {
    const [p] = await db.select({ id: personnel.id, fullName: personnel.fullName })
      .from(personnel)
      .where(and(eq(personnel.isDeleted, 0), sql`lower(btrim(${personnel.fullName})) = lower(btrim(${String(nameStr)}))`));
    return { name: nameStr, id: p ? p.id : null };
  }

  return { name: '', id: null };
}
