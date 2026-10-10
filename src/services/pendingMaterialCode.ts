import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/drizzle.js';
import { categories } from '../db/schema.js';
import { ValidationError } from '../errors/customErrors.js';
import { pendingMaterialCodeError } from '../lib/pendingMaterials/materialRequestRules.js';

/**
 * v10.0.103 (TD-1202, roles-b finding 8): what an approved raw-material request may become. Its category, when it names a
 * live category, is a raw-material one (422 `PENDING_MATERIAL_CATEGORY_INVALID`), and its code follows the raw-material
 * pattern with that category's prefix (422 `PENDING_MATERIAL_CODE_FORMAT`). Before, a product category and any code
 * («XYZ-9») were accepted and the item was created with them.
 */
export async function assertApprovableMaterial(tx: DbExecutor, code: string, categoryName: string): Promise<void> {
  const [category] = await tx
    .select({ name: categories.name, prefix: categories.prefix, type: categories.type })
    .from(categories)
    .where(and(eq(categories.isDeleted, 0), sql`lower(btrim(${categories.name})) = lower(btrim(${categoryName}::text))`))
    .limit(1);
  if (category && category.type !== 'raw_material') {
    throw new ValidationError(
      `دسته «${category.name}» دسته محصول نهایی است؛ برای ماده اولیه یکی از دسته‌های مواد اولیه را برگزینید.`,
      undefined,
      'PENDING_MATERIAL_CATEGORY_INVALID',
    );
  }
  const codeError = pendingMaterialCodeError(code, category ?? null);
  if (codeError) throw new ValidationError(codeError, undefined, 'PENDING_MATERIAL_CODE_FORMAT');
}
