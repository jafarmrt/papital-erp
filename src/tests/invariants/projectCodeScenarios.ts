import { pool } from '../../db/drizzle.js';
import { businessFiscalYear, businessTodayIsoDate } from '../../lib/businessClock.js';
import { ProjectService } from '../../services/projects.service.js';
import { getErrorMessage } from '../../utils/formatters.js';

/**
 * v8.0.80 — کد خودکار پروژه از شمارنده اتمی سال (TD-350) برای سوئیت business_invariants.
 * فهرست خالی یعنی رفتار درست.
 */

async function createWithCode(title: string, projectCode?: string): Promise<string> {
  const { project } = await ProjectService.createProject({
    title, projectCode, startDate: await businessTodayIsoDate(), quantity: 1,
  } as Parameters<typeof ProjectService.createProject>[0]);
  return project.projectCode;
}

function fulfilledCodes(outcomes: PromiseSettledResult<string>[], label: string, problems: string[]): string[] {
  const codes: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') codes.push(outcome.value);
    else problems.push(`${label} رد شد: ${getErrorMessage(outcome.reason)}`);
  }
  if (new Set(codes).size !== codes.length) problems.push(`${label} کد تکراری گرفت (${codes.join('، ')})`);
  return codes;
}

/**
 * TD-350: پیش‌تر شماره کد خودکار `COUNT(*) + 1` بود؛ پنج پروژه هم‌زمان یک کد می‌گرفتند و چهارتا با خطای یکتایی رد می‌شدند،
 * دو پروژه هم‌زمان با یک کد دستی هم یکی رد می‌شد، و کدی که دستی گرفته شده بود کد خودکار بعدی را «-۱» دار می‌کرد.
 */
export async function checkProjectCodesAtomic(): Promise<string[]> {
  const problems: string[] = [];
  const year = await businessFiscalYear();
  const autoPattern = new RegExp(`^PRJ-${year}-\\d{3,}$`);

  // ۱) پنج پروژه هم‌زمان بی کد: همه ساخته و کدها یکتا و به شکل PRJ-<سال>-<شماره>
  const autos = fulfilledCodes(await Promise.allSettled(Array.from({ length: 5 }, (_, i) => createWithCode(`پروژه آزمون کد هم‌زمان ${i + 1}`))), 'پروژه هم‌زمان', problems);
  if (autos.length !== 5) problems.push(`از پنج پروژه هم‌زمان ${autos.length} ساخته شد`);
  for (const code of autos) if (!autoPattern.test(code)) problems.push(`کد خودکار «${code}» به شکل PRJ-${year}-<شماره> نیست`);

  // ۲) دو پروژه هم‌زمان با یک کد دستی: هر دو ساخته، دومی با پسوند
  const custom = `CUST-${Date.now()}`;
  const customs = fulfilledCodes(await Promise.allSettled([createWithCode('پروژه آزمون کد دستی ۱', custom), createWithCode('پروژه آزمون کد دستی ۲', custom)]), 'کد دستی هم‌زمان', problems);
  if (customs.length === 2 && !(customs.includes(custom) && customs.includes(`${custom}-1`))) problems.push(`کدهای دستی هم‌زمان «${customs.join('، ')}» شدند، نه ${custom} و ${custom}-1`);

  // ۳) کد خودکار بعدی که دستی گرفته شده است کنار گذاشته می‌شود
  const counter = await pool.query<{ last: number }>(`SELECT last_ref_number AS last FROM document_ref_counters WHERE doc_type = 'project' AND fiscal_year = $1`, [year]);
  const next = Number(counter.rows[0]?.last ?? 0) + 1;
  const reserved = `PRJ-${year}-${String(next).padStart(3, '0')}`;
  await createWithCode('پروژه آزمون کد دستیِ شماره بعدی', reserved);
  const after = await createWithCode('پروژه آزمون کد پس از کد دستی');
  if (!autoPattern.test(after) || after === reserved) problems.push(`کد خودکار پس از گرفتن دستی ${reserved} «${after}» شد`);
  return problems;
}
