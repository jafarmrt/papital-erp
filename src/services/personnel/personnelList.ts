import { and, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel, users } from '../../db/schema.js';
import { foldedSearchSql } from '../../lib/search/searchSql.js';
import { normalizeSearchText } from '../../lib/search/searchText.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { PersonnelReadScope } from './personnelFieldScope.js';
import type { PersonnelListStats } from '../../lib/personnel/personnelList.js';

// v7.0.140: ستون‌های فهرست و جزئیات پرسنل یکی است (پیش‌تر دو بار تکرار شده بود)
export const PERSONNEL_DETAIL_COLUMNS = {
  id: personnel.id,
  firstName: personnel.firstName,
  lastName: personnel.lastName,
  fullName: personnel.fullName,
  personnelCode: personnel.personnelCode,
  userId: personnel.userId,
  username: users.username,
  userFullName: users.fullName,
  gender: personnel.gender,
  birthDate: personnel.birthDate,
  nationality: personnel.nationality,
  nationalId: personnel.nationalId,
  phone: personnel.phone,
  employmentStatus: personnel.employmentStatus,
  // V1.3.3 (باگ اصلی): بدون این دو فیلد، فرم پرسنل پس از ذخیره/رفرش به پیش‌فرض برمی‌گشت
  salaryType: personnel.salaryType,
  monthlySalary: personnel.monthlySalary,
  jobTitle: personnel.jobTitle,
  education: personnel.education,
  startDate: personnel.startDate,
  // v10.0.210 (TD-1087): «مشمول بیمه» و «مشمول مالیات حقوق»
  isInsuranceCovered: personnel.isInsuranceCovered,
  isTaxCovered: personnel.isTaxCovered,
  isEidiCovered: personnel.isEidiCovered,
  // v10.2 بستهٔ ۹: نمایش روز و ماه تولد به همکاران در پیشخوان
  isBirthdayVisible: personnel.isBirthdayVisible,
  endDate: personnel.endDate,
  terminationReason: personnel.terminationReason,
  specializedSkills: personnel.specializedSkills,
  otherSkills: personnel.otherSkills,
  referralSource: personnel.referralSource,
  cardNumber: personnel.cardNumber,
  accountNumber: personnel.accountNumber,
  shebaNumber: personnel.shebaNumber,
  bankName: personnel.bankName,
  nobitexUsername: personnel.nobitexUsername,
  nobitexPassword: personnel.nobitexPassword,
  address: personnel.address,
  notes: personnel.notes,
  createdAt: personnel.createdAt,
  updatedAt: personnel.updatedAt,
  version: personnel.version
};


/**
 * OBS-R2-57 / OBS-R1-69 (v10.2.x, TD-1321): the personnel list is filtered and paged in SQL. The search looks only at the
 * fields the reader sees (a pick-list reader never finds a personnel by national ID or phone), and card, account and Sheba
 * numbers only for a reader who sees them unmasked; text is folded like `normalizeSearchText` on both sides.
 */
export interface PersonnelListFilter {
  search?: string;
  status?: string;
  scope: PersonnelReadScope;
  canViewSensitive: boolean;
}

function searchColumns(filter: PersonnelListFilter) {
  const pick = [personnel.fullName, personnel.firstName, personnel.lastName, personnel.personnelCode, personnel.jobTitle];
  if (!filter.scope.dossier) return pick;
  const dossier = [
    ...pick, personnel.phone, personnel.nationalId, personnel.education, personnel.specializedSkills, personnel.otherSkills,
    personnel.bankName, personnel.address, personnel.notes, personnel.referralSource, users.username,
  ];
  return filter.canViewSensitive ? [...dossier, personnel.cardNumber, personnel.accountNumber, personnel.shebaNumber] : dossier;
}

export function personnelListConditions(filter: PersonnelListFilter): SQL {
  const conditions: SQL[] = [eq(personnel.isDeleted, 0)];
  const status = (filter.status ?? '').trim();
  if (status && status !== 'all') conditions.push(eq(personnel.employmentStatus, status));
  const q = normalizeSearchText(filter.search);
  if (q) {
    const pattern = containsLikePattern(q);
    const matches = or(...searchColumns(filter).map((column) => sql`${foldedSearchSql(column)} LIKE ${pattern}`));
    if (matches) conditions.push(matches);
  }
  return and(...conditions) as SQL;
}

export async function listPersonnelRows(filter: PersonnelListFilter, window: { limit?: number; offset?: number } = {}) {
  const query = orm.select(PERSONNEL_DETAIL_COLUMNS)
    .from(personnel)
    .leftJoin(users, eq(personnel.userId, users.id))
    .where(personnelListConditions(filter))
    .orderBy(desc(personnel.id))
    .$dynamic();
  if (window.limit !== undefined) query.limit(window.limit);
  if (window.offset) query.offset(window.offset);
  return query;
}

export async function countPersonnelRows(filter: PersonnelListFilter): Promise<number> {
  const [row] = await orm.select({ total: count() })
    .from(personnel)
    .leftJoin(users, eq(personnel.userId, users.id))
    .where(personnelListConditions(filter));
  return Number(row?.total ?? 0);
}

/** The personnel page cards over every live personnel, whatever the filter (the page's earlier rule) */
export async function personnelListStats(): Promise<PersonnelListStats> {
  const [row] = await orm.select({
    total: count(),
    active: sql<number>`count(*) FILTER (WHERE ${personnel.employmentStatus} = 'فعال')`,
    terminated: sql<number>`count(*) FILTER (WHERE ${personnel.employmentStatus} = 'قطع همکاری')`,
    onLeave: sql<number>`count(*) FILTER (WHERE ${personnel.employmentStatus} IN ('مرخصی', 'تعلیق'))`,
    usersCount: sql<number>`count(*) FILTER (WHERE ${personnel.userId} IS NOT NULL)`,
  }).from(personnel).where(eq(personnel.isDeleted, 0));
  return {
    total: Number(row?.total ?? 0), active: Number(row?.active ?? 0), terminated: Number(row?.terminated ?? 0),
    onLeave: Number(row?.onLeave ?? 0), usersCount: Number(row?.usersCount ?? 0),
  };
}
