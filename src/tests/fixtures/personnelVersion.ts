import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';

/** v9.0.30 (TD-442): نسخه فعلی پرسنل برای بدنه PUT /personnel/:id، همان که فرم ویرایش از جزئیات می‌گیرد */
export async function personnelVersion(id: number | string): Promise<number> {
  const [row] = await orm.select({ version: personnel.version }).from(personnel).where(eq(personnel.id, Number(id)));
  return row?.version ?? 1;
}
