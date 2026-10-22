import { z } from 'zod';
import { PROJECT_PARTS, PROJECT_PART_TOKEN_PATTERN, type ProjectPart } from '../lib/projects/projectParts.js';

// TD-1342 (بستهٔ ۱۲ بند ۴، ت۴۲ ب): نشانهٔ بخش‌هایی که زبانه از آن‌ها ساخته شده؛ هر کلید دیگر ۴۰۰ است
const partToken = z.string().regex(PROJECT_PART_TOKEN_PATTERN, 'نشانهٔ بخش پروژه نامعتبر است؛ پروژه را دوباره باز کنید.');

export const projectPartTokensSchema = z.object(
  Object.fromEntries(PROJECT_PARTS.map(part => [part, partToken.optional()])) as Record<ProjectPart, z.ZodOptional<typeof partToken>>,
).strict();
