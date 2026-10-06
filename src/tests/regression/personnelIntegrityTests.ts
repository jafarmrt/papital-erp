import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';

/**
 * بسته ۱۲ (بخش پرسنل) — یکپارچگی داده پرسنل در مسیرهای واقعی Express؛ هر آزمون روی کد پیشین قرمز است.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Session = { cookie: string; csrfToken: string };

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin: Session = await getAdminSession();
  const send = (method: 'post' | 'put' | 'delete', url: string, body: object = {}) =>
    request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
  return { app, admin, send };
}

async function runCase(
  results: TestCaseResult[], id: string, name: string, body: (cleanupIds: number[]) => Promise<string>,
): Promise<void> {
  const tStart = Date.now();
  const cleanupIds: number[] = [];
  try {
    const details = await body(cleanupIds);
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (cleanupIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, cleanupIds)).catch(() => undefined);
  }
}

const tagOf = () => String(Date.now()).slice(-6);

export async function runPersonnelIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const importId = 'reg_personnel_import_keeps_status_td_436';
  if (shouldRun(importId, 'td436', 'personnel', 'excel', 'package12')) {
    await runCase(results, importId, 'v9.0.25: ورود اکسل با «به‌روزرسانی» خانه خالی جنسیت، وضعیت همکاری و ملیت را «بی تغییر» می‌گیرد؛ پیش‌فرض فقط برای پرسنل تازه است (TD-436)', async (ids) => {
      const { send } = await adminClient();
      const tag = tagOf();
      const code = `IMP-${tag}`;
      const created = await send('post', '/api/personnel', {
        firstName: 'مریم', lastName: `اکسل ${tag}`, personnelCode: code, gender: 'زن', employmentStatus: 'قطع همکاری',
        nationality: 'افغانستانی', endDate: '2026-03-11', terminationReason: 'پایان قرارداد',
      });
      if (created.status !== 201) throw new Error(`ثبت پرسنل ${created.status} داد`);
      ids.push(Number(created.body.id));
      const wrong: string[] = [];
      // ۱) ستون‌ها نیامده، ۲) ستون‌ها با خانه خالی (شکل ارسال پیش‌نمایش)
      for (const [label, extra] of [['بی ستون', {}], ['خانه خالی', { gender: '', employmentStatus: '', nationality: '' }]] as const) {
        const res = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: code, firstName: 'مریم', lastName: `اکسل ${tag}`, phone: '09351234567', ...extra }] });
        if (res.status !== 200 || res.body?.updatedCount !== 1) wrong.push(`${label}: ورود ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        const [row] = await orm.select().from(personnel).where(eq(personnel.id, Number(created.body.id)));
        if (row.gender !== 'زن' || row.employmentStatus !== 'قطع همکاری' || row.nationality !== 'افغانستانی') {
          wrong.push(`${label}: ${row.gender}، ${row.employmentStatus}، ${row.nationality} شد`);
        }
        if (row.phone !== '09351234567') wrong.push(`${label}: تلفن ${row.phone} شد`);
      }
      // ۳) مقدار صریح جایگزین می‌شود
      await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: code, firstName: 'مریم', employmentStatus: 'فعال' }] });
      const [after] = await orm.select().from(personnel).where(eq(personnel.id, Number(created.body.id)));
      if (after.employmentStatus !== 'فعال') wrong.push(`وضعیت صریح «فعال» ${after.employmentStatus} شد`);
      // ۴) پرسنل تازه بی این ستون‌ها پیش‌فرض می‌گیرد
      const fresh = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: `${code}-N`, firstName: 'تازه', lastName: `اکسل ${tag}` }] });
      const [newRow] = await orm.select().from(personnel).where(and(eq(personnel.personnelCode, `${code}-N`), eq(personnel.isDeleted, 0)));
      if (newRow) ids.push(newRow.id);
      if (fresh.status !== 200 || !newRow || newRow.gender !== 'مرد' || newRow.employmentStatus !== 'فعال' || newRow.nationality !== 'ایرانی') {
        wrong.push(`پرسنل تازه: ${fresh.status} ${JSON.stringify(newRow ? [newRow.gender, newRow.employmentStatus, newRow.nationality] : null)}`);
      }
      if (wrong.length > 0) throw new Error(wrong.join('؛ '));
      return 'خانه خالی و ستون نیامده: زن، قطع همکاری، افغانستانی ماند و تلفن به‌روز شد؛ مقدار صریح جایگزین شد؛ پرسنل تازه پیش‌فرض گرفت';
    });
  }

  return results;
}
