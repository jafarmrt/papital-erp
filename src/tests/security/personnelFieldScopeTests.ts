import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { personnel, roles, users } from '../../db/schema.js';

/**
 * بسته ۱۲ (بخش پرسنل) — دامنه فیلدهای فهرست و جزئیات پرسنل (تصمیم مالک محصول D1 الف) در مسیرهای واقعی Express؛
 * روی کد پیشین قرمز است: هر خواننده فهرست انتخاب حقوق ماهانه، کد ملی، نشانی، تاریخ تولد و یادداشت را می‌گرفت.
 */

interface Session { cookie: string; csrfToken: string }
type Row = Record<string, unknown>;

/** کلیدهایی که خواننده فهرست انتخاب نباید ببیند */
const DOSSIER_KEYS = ['nationalId', 'phone', 'birthDate', 'address', 'notes', 'cardNumber', 'shebaNumber', 'accountNumber', 'nobitexUsername', 'terminationReason'];
const SALARY_KEYS = ['monthlySalary', 'salaryType'];

export async function runPersonnelFieldScopeTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'sec_personnel_field_scope_td_434';
  if (!shouldRun(id, 'security', 'td434', 'personnel', 'salary', 'package12')) return results;

  const name = 'v9.0.23: فهرست و جزئیات پرسنل به خوانندگان فهرست انتخاب فقط شناسه، نام، کد، عنوان شغلی و وضعیت می‌دهند؛ پرونده کامل فقط personnel.view / personnel.manage، حقوق فقط دامنه مبالغ فیش و رمز نوبیتکس فقط در جزئیات (TD-434)';
  const tStart = Date.now();
  const personnelIds: number[] = [];
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const previousKey = process.env.ERP_SECRETS_KEY;
  try {
    process.env.ERP_SECRETS_KEY = previousKey || 'td434-test-key-0123456789-abcdefghijklmnop';
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const tag = String(Date.now()).slice(-6);
    const wrong: string[] = [];

    const created = await request(app).post('/api/personnel').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({
      firstName: 'زهرا', lastName: `آزمون ${tag}`, personnelCode: `FS-${tag}`, jobTitle: 'زرگر', employmentStatus: 'فعال',
      salaryType: 'monthly_fixed', monthlySalary: 45000000, nationalId: '0012345679', phone: '09121234567', birthDate: '1991-08-03',
      address: 'تهران، خیابان آزمون، پلاک ۱', notes: 'یادداشت محرمانه مدیر', cardNumber: '6037991234567890',
      shebaNumber: 'IR120120000000001234567890', nobitexUsername: 'zahra_test', nobitexPassword: 'Secret#434',
    });
    if (created.status !== 201) throw new Error(`ثبت پرسنل ${created.status} داد: ${JSON.stringify(created.body).slice(0, 160)}`);
    const pid = Number(created.body.id);
    personnelIds.push(pid);

    const sessionWith = async (permissions: string[] | string): Promise<Session> => {
      let roleCode: string;
      if (typeof permissions === 'string') {
        roleCode = permissions;
      } else {
        const role = await createTestRole({ permissions });
        roleIds.push(role.id);
        roleCode = role.code;
      }
      const user = await createTestUser({ role: roleCode });
      userIds.push(user.id);
      return loginTestUserWithSession(app, user.username);
    };
    const read = async (s: Session, query = ''): Promise<{ listed?: Row; detail?: Row }> => {
      const list = await request(app).get(`/api/personnel${query}`).set('Cookie', s.cookie);
      const detail = await request(app).get(`/api/personnel/${pid}`).set('Cookie', s.cookie);
      if (list.status !== 200 || detail.status !== 200) throw new Error(`فهرست/جزئیات پرسنل ${list.status}/${detail.status} داد`);
      const listed = (Array.isArray(list.body) ? list.body : []).find((r: Row) => Number(r.id) === pid) as Row | undefined;
      return { listed, detail: detail.body as Row };
    };
    const leaked = (row: Row | undefined, keys: string[]) => keys.filter(k => row !== undefined && k in row && row[k] !== '' && row[k] !== null);

    // ۱) خوانندگان فهرست انتخاب (نقش seed‌شده viewer و نقش‌های تک‌مجوز): فقط فیلدهای انتخاب
    const pickReaders: Array<[string, string[] | string]> = [
      ['viewer', 'viewer'], ['crm.view', ['crm.view']], ['documents.view', ['documents.view']], ['documents.create', ['documents.create']],
      ['warehouse.in', ['warehouse.in']], ['projects.view', ['projects.view']], ['piecework.view', ['piecework.view']], ['accounting.view', ['accounting.view']],
    ];
    for (const [label, perms] of pickReaders) {
      const s = await sessionWith(perms);
      const { listed, detail } = await read(s);
      if (!listed) { wrong.push(`${label}: پرسنل در فهرست نیامد`); continue; }
      if (listed.fullName !== `زهرا آزمون ${tag}` || listed.personnelCode !== `FS-${tag}` || listed.jobTitle !== 'زرگر' || listed.employmentStatus !== 'فعال') {
        wrong.push(`${label}: فیلدهای انتخاب ناقص ${JSON.stringify(listed).slice(0, 160)}`);
      }
      for (const [where, row] of [['فهرست', listed], ['جزئیات', detail]] as const) {
        const keys = leaked(row, [...DOSSIER_KEYS, ...SALARY_KEYS, 'nobitexPassword']);
        if (keys.length > 0) wrong.push(`${label} در ${where}: ${keys.join('، ')}`);
      }
      // جست‌وجو فقط روی فیلدهای دیدنی: کد ملی پرسنل را پیدا نمی‌کند
      const bySecret = await read(s, `?search=0012345679`);
      if (bySecret.listed) wrong.push(`${label}: جست‌وجوی کد ملی پرسنل را یافت`);
    }

    // ۲) personnel.view: پرونده کامل بی حقوق، کارت و شبا ماسک‌شده، بی رمز نوبیتکس
    {
      const { listed, detail } = await read(await sessionWith(['personnel.view']));
      for (const [where, row] of [['فهرست', listed], ['جزئیات', detail]] as const) {
        if (row?.nationalId !== '0012345679' || row?.address !== 'تهران، خیابان آزمون، پلاک ۱') wrong.push(`personnel.view در ${where}: پرونده کامل نیامد`);
        const keys = leaked(row, [...SALARY_KEYS, 'nobitexPassword']);
        if (keys.length > 0) wrong.push(`personnel.view در ${where}: ${keys.join('، ')}`);
        if (row?.cardNumber === '6037991234567890') wrong.push(`personnel.view در ${where}: شماره کارت بی ماسک`);
      }
    }

    // ۳) دامنه مبالغ فیش بی پرونده (piecework.view + piecework.payroll): فیلدهای انتخاب و حقوق
    {
      const { listed, detail } = await read(await sessionWith(['piecework.view', 'piecework.payroll']));
      for (const [where, row] of [['فهرست', listed], ['جزئیات', detail]] as const) {
        if (Number(row?.monthlySalary) !== 45000000 || row?.salaryType !== 'monthly_fixed') wrong.push(`piecework.payroll در ${where}: حقوق نیامد`);
        const keys = leaked(row, [...DOSSIER_KEYS, 'nobitexPassword']);
        if (keys.length > 0) wrong.push(`piecework.payroll در ${where}: ${keys.join('، ')}`);
      }
    }

    // ۴) personnel.manage و مدیر سامانه: همه چیز؛ رمز نوبیتکس فقط در جزئیات
    for (const [label, s] of [['personnel.manage', await sessionWith(['personnel.manage'])], ['مدیر سامانه', admin]] as const) {
      const { listed, detail } = await read(s);
      if (Number(listed?.monthlySalary) !== 45000000 || listed?.nationalId !== '0012345679' || listed?.cardNumber !== '6037991234567890') wrong.push(`${label}: پرونده و حقوق کامل در فهرست نیامد`);
      if (listed && 'nobitexPassword' in listed) wrong.push(`${label}: رمز نوبیتکس در فهرست آمد`);
      if (detail?.nobitexPassword !== 'Secret#434' || Number(detail?.monthlySalary) !== 45000000) wrong.push(`${label}: رمز نوبیتکس یا حقوق در جزئیات نیامد`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('؛ '));
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'viewer و هفت نقش تک‌مجوز فقط فیلدهای انتخاب؛ personnel.view پرونده بی حقوق؛ piecework.payroll حقوق بی پرونده؛ personnel.manage و مدیر همه، رمز نوبیتکس فقط در جزئیات',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (previousKey === undefined) delete process.env.ERP_SECRETS_KEY; else process.env.ERP_SECRETS_KEY = previousKey;
    if (personnelIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, personnelIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
