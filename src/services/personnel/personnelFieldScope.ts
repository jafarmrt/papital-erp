import { userHasRoleOrPermission } from '../../middleware/authorize.js';
import { READ_PERMISSIONS } from '../../lib/recordReadPermissions.js';

/**
 * v9.0.23 (TD-434، تصمیم مالک محصول D1 الف): دامنه فیلدهای فهرست و جزئیات پرسنل.
 * - فهرست انتخاب (همه دارندگان `READ_PERMISSIONS.personnel`: پروژه، ارتباط با مشتری، حسابداری، انبار، کارمزدی):
 *   فقط شناسه، نام، کد پرسنلی، عنوان شغلی، وضعیت همکاری و شناسه کاربر متصل (برای یافتن پرسنل کاربر جاری).
 * - پرونده کامل (کد ملی، تلفن، تولد، نشانی، بانک، یادداشت …): فقط `personnel.view` / `personnel.manage`.
 * - حقوق (`salaryType`، `monthlySalary`): فقط دامنه مبالغ فیش (`READ_PERMISSIONS.payrolls`، AGENTS §5).
 * - رمز نوبیتکس هرگز در فهرست نمی‌آید؛ فقط در `GET /personnel/:id` و فقط برای کاربر مجاز داده حساس.
 * پیش‌تر هر خواننده فهرست انتخاب، از جمله نقش «کاربر تماشاگر»، حقوق و اطلاعات شخصی همه پرسنل را می‌گرفت.
 */
export const PERSONNEL_DOSSIER_PERMISSIONS = ['personnel.view', 'personnel.manage'] as const;

export const PERSONNEL_PICK_KEYS = ['id', 'firstName', 'lastName', 'fullName', 'personnelCode', 'jobTitle', 'employmentStatus', 'userId', 'version'] as const;
export const PERSONNEL_SALARY_KEYS = ['salaryType', 'monthlySalary'] as const;

export interface PersonnelReadScope {
  dossier: boolean;
  salary: boolean;
}

export async function personnelReadScope(user: { role?: string } | undefined): Promise<PersonnelReadScope> {
  const [dossier, salary] = await Promise.all([
    userHasRoleOrPermission(user, ...PERSONNEL_DOSSIER_PERMISSIONS),
    userHasRoleOrPermission(user, ...READ_PERMISSIONS.payrolls),
  ]);
  return { dossier, salary };
}

/** ردیف پرسنل فقط با فیلدهایی که این دامنه می‌بیند */
export function scopePersonnelRow<T extends object>(row: T, scope: PersonnelReadScope): Partial<T> {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (scope.dossier) {
    Object.assign(out, source);
    if (!scope.salary) for (const k of PERSONNEL_SALARY_KEYS) delete out[k];
  } else {
    for (const k of PERSONNEL_PICK_KEYS) if (k in source) out[k] = source[k];
    if (scope.salary) for (const k of PERSONNEL_SALARY_KEYS) if (k in source) out[k] = source[k];
  }
  return out as Partial<T>;
}

/** ردیف فهرست بی رمز نوبیتکس (رمز فقط در جزئیات یک پرسنل) */
export function withoutNobitexPassword<T extends object>(row: T): Omit<T, 'nobitexPassword'> {
  const { nobitexPassword: _secret, ...rest } = row as T & { nobitexPassword?: unknown };
  return rest;
}

const SEARCH_KEYS = [
  'fullName', 'firstName', 'lastName', 'personnelCode', 'phone', 'nationalId', 'jobTitle', 'specializedSkills',
  'otherSkills', 'education', 'bankName', 'notes', 'address',
] as const;

/** جست‌وجوی فهرست فقط روی فیلدهایی که خواننده می‌بیند (جست‌وجو با کد ملی، پرسنل را برای خواننده فهرست انتخاب نمی‌یابد) */
export function matchesPersonnelSearch(row: object, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const source = row as Record<string, unknown>;
  return SEARCH_KEYS.some(k => typeof source[k] === 'string' && (source[k] as string).toLowerCase().includes(q));
}
