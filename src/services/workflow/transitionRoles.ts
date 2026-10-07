import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { roles, workflowDefinitions, workflowInstances, workflowTransitions } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';

/**
 * v9.0.111 (TD-542، یافته B02-27، مدل مجوز §۴.۲): هر اقدام گردش کار یک مجوز می‌خواهد و اختیاراً یک نقش مشخص که طراح از
 * فهرست نقش‌ها برمی‌گزیند. کد نقش شناسه ثابت و یکتای نقش است (ویرایش نقش آن را عوض نمی‌کند و کاربر هم با همین کد به
 * نقش وصل است)، پس اقدام با همین کد به نقش وصل می‌ماند: نقش ناموجود ذخیره نمی‌شود و نقشی که اقدامی به آن بسته است حذف
 * نمی‌شود. پیش‌تر نقش اقدام متن آزاد بود و طراح در نصب بی نقش پنج کد ثابت پیشنهاد می‌داد.
 */

/** نقشی که «همه» را می‌پذیرد (همان شرط checkUserRoleMatch) */
export function isOpenTransitionRole(role: string | null | undefined): boolean {
  return !role || role === '*' || role === 'ALL';
}

/** فرایندهایی که تا پایان نرسیده‌اند و با تصویر خود ادامه می‌دهند */
export const OPEN_WORKFLOW_INSTANCE_STATUSES = ['IN_PROGRESS', 'REJECTED'];

interface DesignTransitionRole {
  requiredRole?: string;
  title?: string;
  actionKey?: string;
}

/**
 * کد ثبت‌شده نقش هر اقدام (کلید: کد با حروف کوچک). نقشی که در فهرست نقش‌ها نیست طرح را با ۴۲۲ `WF_UNKNOWN_ROLE` رد
 * می‌کند و پیام نام اقدام و نقش را می‌گوید.
 */
export async function resolveTransitionRoles(db: DbExecutor, transitions: DesignTransitionRole[]): Promise<Map<string, string>> {
  const wanted = transitions
    .map(tr => (tr.requiredRole || '').trim())
    .filter(role => !isOpenTransitionRole(role));
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ code: roles.code }).from(roles)
    .where(inArray(sql`lower(${roles.code})`, [...new Set(wanted.map(r => r.toLowerCase()))]));
  const known = new Map(rows.map(r => [r.code.toLowerCase(), r.code]));
  const errors = transitions
    .filter(tr => !isOpenTransitionRole((tr.requiredRole || '').trim()) && !known.has((tr.requiredRole || '').trim().toLowerCase()))
    .map(tr => `نقش «${(tr.requiredRole || '').trim()}» اقدام «${tr.title || tr.actionKey || ''}» در فهرست نقش‌ها نیست؛ نقش را از فهرست برگزینید یا خالی بگذارید تا فقط مجوز سنجیده شود.`);
  if (errors.length > 0) {
    throw new ValidationError(`طرح گردش کار ذخیره نشد: ${errors.join(' ')}`, { errors }, 'WF_UNKNOWN_ROLE');
  }
  return known;
}

/** کد ذخیره‌شدنی نقش یک اقدام، پس از resolveTransitionRoles */
export function storedTransitionRole(role: string | undefined, known: Map<string, string>): string {
  const trimmed = (role || '').trim();
  return isOpenTransitionRole(trimmed) ? trimmed : (known.get(trimmed.toLowerCase()) ?? trimmed);
}

/**
 * گردش‌کارهایی که اقدامی از آن‌ها این نقش را می‌خواهد: طرح جاری هر تعریف و تصویر فرایندهای پایان‌نیافته (عنوان‌ها
 * برای پیام). حذف چنین نقشی گام را بی امضاکننده می‌گذارد.
 */
export async function workflowsRequiringRole(db: DbExecutor, roleCode: string): Promise<string[]> {
  const code = roleCode.trim().toLowerCase();
  const live = await db.selectDistinct({ title: workflowDefinitions.title, id: workflowDefinitions.id })
    .from(workflowTransitions)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowTransitions.workflowDefinitionId))
    .where(sql`lower(btrim(coalesce(${workflowTransitions.requiredRole}, ''))) = ${code}`)
    .orderBy(asc(workflowDefinitions.id));
  const running = await db.selectDistinct({ title: workflowDefinitions.title, id: workflowDefinitions.id })
    .from(workflowInstances)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowInstances.workflowDefinitionId))
    .where(and(
      inArray(workflowInstances.status, OPEN_WORKFLOW_INSTANCE_STATUSES),
      sql`jsonb_typeof(${workflowInstances.snapshotDsl} -> 'transitions') = 'array'`,
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${workflowInstances.snapshotDsl} -> 'transitions') t
                  WHERE lower(btrim(coalesce(t ->> 'requiredRole', ''))) = ${code})`,
    ))
    .orderBy(asc(workflowDefinitions.id));
  return [...new Set([...live, ...running].map(r => r.title || `#${r.id}`))];
}
