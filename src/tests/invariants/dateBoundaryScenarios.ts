import pg from 'pg';
import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { ChartOfAccountsService } from '../../services/accounting/chartOfAccounts.service.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * v8.0.47 — سناریوهای سخت‌گیرانه مرز تاریخ (حوزه I نقشه راه V8) برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

/** سال کبیسه ۱۳۸۷: ۳۰ اسفند = 2009-03-20 و ۱ فروردین ۱۳۸۸ = 2009-03-21؛ دور از سال‌های آزمون‌های دیگر */
const LEAP_CLOSING_YEAR = 1387;
const LEAP_FIRST_DAY = '2008-03-20';
const LEAP_LAST_DAY = '2009-03-20';
const NEXT_FIRST_DAY = '2009-03-21';

async function revenueOfYear(accountId: number): Promise<string> {
  const res = await pool.query<{ bal: string }>(
    `SELECT COALESCE(SUM(i.credit - i.debit), 0)::text AS bal
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.status IN ('approved', 'permanent')
        AND i.account_id = $1 AND v.date >= $2 AND v.date < $3`,
    [accountId, LEAP_FIRST_DAY, NEXT_FIRST_DAY]);
  return fin(res.rows[0]?.bal ?? 0).toString();
}

/**
 * TD-310: بستن سال مالی کبیسه، سند ۳۰ اسفند را هم می‌بندد. اسناد اختتامیه به آخرین روز سال و افتتاحیه به ۱ فروردین سال
 * بعد صادر می‌شوند، تاریخ دیگری پذیرفته نمی‌شود و پس از بستن، مانده درآمد سال صفر است.
 */
export async function checkClosingCoversLeapLastDay(): Promise<string[]> {
  const problems: string[] = [];
  await ChartOfAccountsService.seedStandardAccounts();
  const all = await ChartOfAccountsService.getAllAccounts();
  const revenue = all.find(a => a.code === '6001') || all.find(a => a.accountType === 'revenue');
  const asset = all.find(a => a.code === '1101') || all.find(a => a.accountType === 'asset');
  if (!revenue || !asset) return ['سرفصل درآمد یا دارایی آزمون یافت نشد'];

  const sale = (date: string, amount: number, ref: string) => VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'approved', description: `فروش آزمون مرز سال ${ref}`,
    referenceModule: 'manual', referenceNumber: `TEST-TD310-${ref}`,
    items: [
      { accountId: asset.id, detailedType: 'other', detailedName: 'دارایی آزمون', debit: amount, credit: 0, description: 'بدهکار' },
      { accountId: revenue.id, detailedType: 'other', detailedName: 'درآمد آزمون', debit: 0, credit: amount, description: 'بستانکار' },
    ],
  });
  await sale('2008-06-15', 1000000, 'MID');
  await sale(LEAP_LAST_DAY, 500000, 'LAST'); // ۳۰ اسفند ۱۳۸۷

  const preview = await FiscalYearService.getFiscalYearClosingPreview({ year: LEAP_CLOSING_YEAR });
  if (preview.closingDate !== LEAP_LAST_DAY || preview.openingDateNewYear !== NEXT_FIRST_DAY) {
    problems.push(`تاریخ‌های پیش‌نمایش ${preview.closingDate} و ${preview.openingDateNewYear} است؛ انتظار ${LEAP_LAST_DAY} و ${NEXT_FIRST_DAY}`);
  }
  if (!fin(preview.netProfit).equals(1500000)) {
    problems.push(`سود پیش‌نمایش ${preview.netProfit} است؛ فروش ۳۰ اسفند (۵۰۰٬۰۰۰) باید در سود ۱٬۵۰۰٬۰۰۰ باشد`);
  }

  let refused = '';
  try {
    await FiscalYearService.getFiscalYearClosingPreview({ year: LEAP_CLOSING_YEAR, closingDate: `${LEAP_CLOSING_YEAR}/12/29` });
  } catch (err) {
    refused = getErrorMessage(err);
  }
  if (!refused.includes('آخرین روز')) problems.push('تاریخ اختتامیه ۲۹ اسفند در سال کبیسه پذیرفته شد');

  try {
    const closed = await FiscalYearService.executeFiscalYearClosing({ year: LEAP_CLOSING_YEAR, createOpeningVoucher: true, username: 'inv' });
    const byRef = new Map(closed.closingVouchers.map(v => [v.referenceNumber, v.date]));
    if (byRef.get(`CLOSE-TEMP-${LEAP_CLOSING_YEAR}`) !== LEAP_LAST_DAY || byRef.get(`CLOSING-${LEAP_CLOSING_YEAR}`) !== LEAP_LAST_DAY) {
      problems.push(`اسناد بستن به تاریخ ${byRef.get(`CLOSE-TEMP-${LEAP_CLOSING_YEAR}`)} / ${byRef.get(`CLOSING-${LEAP_CLOSING_YEAR}`)} صادر شدند؛ انتظار ${LEAP_LAST_DAY}`);
    }
    if (byRef.get(`OPENING-${LEAP_CLOSING_YEAR + 1}`) !== NEXT_FIRST_DAY) {
      problems.push(`سند افتتاحیه به تاریخ ${byRef.get(`OPENING-${LEAP_CLOSING_YEAR + 1}`)} صادر شد؛ انتظار ${NEXT_FIRST_DAY}`);
    }
    const left = await revenueOfYear(revenue.id);
    if (!fin(left).isZero()) problems.push(`پس از بستن سال ${LEAP_CLOSING_YEAR} مانده درآمد ${left} باقی ماند`);
  } catch (err) {
    problems.push(`بستن سال ${LEAP_CLOSING_YEAR} رد شد: ${getErrorMessage(err)}`);
  }
  return problems;
}

async function documentRow(id: number): Promise<{ date: string; refNumber: string; refFiscalYear: number | null } | undefined> {
  const res = await pool.query<{ date: string; ref_number: string; ref_fiscal_year: number | null }>(
    `SELECT to_char(date, 'YYYY-MM-DD HH24:MI:SS') AS date, ref_number, ref_fiscal_year FROM documents WHERE id = $1`, [id]);
  const r = res.rows[0];
  return r ? { date: r.date, refNumber: r.ref_number, refFiscalYear: r.ref_fiscal_year } : undefined;
}

/**
 * TD-313: تاریخ ناموجود یا غیرتاریخ سند با پیام فارسی رد می‌شود (نه جابه‌جایی بی‌صدا یا خطای ۵۰۰)، سال شماره‌گذاری از
 * تاریخ ذخیره‌شده است، و پیش‌نویسی که تاریخش به سال مالی دیگر برود شماره بعدی همان سال را می‌گیرد (گزینه الف).
 * سال‌های ۱۳۹۶ (عادی) و ۱۳۹۷، دور از داده آزمون‌های دیگر.
 */
export async function checkDocumentDatesStrict(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const draft = (date: string, refNumber?: string) => DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'draft', date, user: 'inv', buyerName: 'مشتری آزمون مرز تاریخ',
    ...(refNumber ? { refNumber } : {}),
    items: [{ itemId: item.id, quantity: 1, unitPrice: 1000, location: wh }],
  });

  for (const bad of ['1396/12/30', '2018-02-30', 'نامعلوم']) {
    let message = '';
    try {
      const id = await draft(bad);
      const row = await documentRow(id);
      message = `پذیرفته شد (تاریخ ${row?.date}، سال شماره ${row?.refFiscalYear})`;
    } catch (err) {
      message = getErrorMessage(err);
    }
    if (!message.includes('معتبر نیست')) problems.push(`تاریخ «${bad}» رد نشد: ${message.slice(0, 120)}`);
  }

  const nowruzId = await draft('1397/01/01 00:15');
  const nowruz = await documentRow(nowruzId);
  if (nowruz?.date !== '2018-03-21 00:15:00' || nowruz.refFiscalYear !== 1397) {
    problems.push(`سند ۰۰:۱۵ نوروز ۱۳۹۷ با تاریخ ${nowruz?.date} و سال شماره ${nowruz?.refFiscalYear} ثبت شد`);
  }

  const movedId = await draft('1396/12/29');
  const before = await documentRow(movedId);
  await DocumentService.updateDocument(movedId, { date: '1397/01/05', refNumber: before?.refNumber });
  const after = await documentRow(movedId);
  if (after?.refFiscalYear !== 1397 || after.date !== '2018-03-25 00:00:00') {
    problems.push(`پیش‌نویس منتقل‌شده به ۵ فروردین ۱۳۹۷ سال شماره ${after?.refFiscalYear} و تاریخ ${after?.date} دارد`);
  }
  const dup = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM documents WHERE type = 'invoice' AND ref_fiscal_year = 1397 AND ref_number = $1 AND is_deleted = 0`,
    [after?.refNumber ?? '']);
  if (Number(dup.rows[0]?.n ?? 0) !== 1 || after?.refNumber === nowruz?.refNumber) {
    problems.push(`شماره پیش‌نویس منتقل‌شده (${after?.refNumber}) در سری ۱۳۹۷ یکتا نیست`);
  }
  return problems;
}

/**
 * TD-317: پیش‌فاکتوری که نهایی می‌شود شماره بعدی سری فاکتور سال خودش را می‌گیرد (گزینه الف)، حتی وقتی شماره
 * پیش‌فاکتورش در فاکتورهای همان سال هست، و شماره پیش‌فاکتور در یادداشت می‌ماند. سال ۱۳۹۸.
 */
export async function checkProformaTakesInvoiceNumber(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2019-05-01', user: 'inv', buyerName: 'تامین‌کننده آزمون پیش‌فاکتور',
    items: [{ itemId: item.id, quantity: 5, unitPrice: 1000, location: wh }],
  });
  const invoiceId = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2019-05-02', user: 'inv', buyerName: 'مشتری آزمون پیش‌فاکتور',
    items: [{ itemId: item.id, quantity: 1, unitPrice: 2000, location: wh }],
  });
  const invoice = await documentRow(invoiceId);
  const proformaId = await DocumentService.createDocument({
    docType: 'proforma', inOut: 'out', status: 'proforma', date: '2019-05-03', user: 'inv', buyerName: 'مشتری آزمون پیش‌فاکتور',
    refNumber: invoice?.refNumber, items: [{ itemId: item.id, quantity: 1, unitPrice: 2000, location: wh }],
  });
  const proforma = await documentRow(proformaId);
  try {
    await DocumentService.finalizeDocument(proformaId, 'inv');
  } catch (err) {
    return [`نهایی‌سازی پیش‌فاکتور شماره ${proforma?.refNumber} رد شد: ${getErrorMessage(err).slice(0, 160)}`];
  }
  const res = await pool.query<{ type: string; ref_number: string; ref_fiscal_year: number; notes: string | null }>(
    'SELECT type, ref_number, ref_fiscal_year, notes FROM documents WHERE id = $1', [proformaId]);
  const after = res.rows[0];
  if (after?.type !== 'invoice' || after.ref_fiscal_year !== 1398) problems.push(`فاکتور حاصل نوع ${after?.type} و سال ${after?.ref_fiscal_year} دارد`);
  if (after?.ref_number !== String(Number(invoice?.refNumber) + 1)) {
    problems.push(`فاکتور حاصل شماره ${after?.ref_number} گرفت؛ انتظار شماره بعدی سری فاکتور (${Number(invoice?.refNumber) + 1})`);
  }
  if (!String(after?.notes ?? '').includes(`پیش‌فاکتور شماره ${proforma?.refNumber}`)) problems.push('شماره پیش‌فاکتور در یادداشت فاکتور نیامد');
  const kardex = await pool.query<{ document_ref: string }>(
    `SELECT DISTINCT document_ref FROM transactions WHERE document_id = $1 AND is_deleted = 0`, [proformaId]);
  if (kardex.rows.some(r => r.document_ref !== after?.ref_number)) problems.push(`ردیف کاردکس شماره ${kardex.rows.map(r => r.document_ref).join('،')} دارد`);
  return problems;
}

/**
 * TD-314: زمان سرور در جلسه پایگاه‌داده UTC است. استخر برنامه TimeZone=UTC را از پارامترهای راه‌اندازی دارد، و جلسه‌ای
 * که پیش‌فرضش تهران است (نصب محلی) با همان پارامترها `now()::timestamp` (مقدار `defaultNow()`) را هم‌وقتِ
 * `toISOString` کد می‌نویسد.
 */
export async function checkSessionClockUtc(): Promise<string[]> {
  const problems: string[] = [];
  const own = await pool.query<{ setting: string; source: string }>(`SELECT setting, source FROM pg_settings WHERE name = 'TimeZone'`);
  if (own.rows[0]?.setting !== 'UTC' || own.rows[0]?.source !== 'client') {
    problems.push(`منطقه زمانی جلسه استخر ${own.rows[0]?.setting} (منبع ${own.rows[0]?.source}) است، نه UTC از پارامترهای راه‌اندازی`);
  }
  const tehranDefault = new pg.Client({ ...pool.options, options: `-c TimeZone=Asia/Tehran ${pool.options.options ?? ''}` });
  await tehranDefault.connect();
  try {
    const res = await tehranDefault.query<{ db_now: string }>(`SELECT to_char(now()::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') AS db_now`);
    const codeNow = new Date().toISOString().slice(0, 19);
    const gapMinutes = Math.abs(Date.parse(`${res.rows[0]?.db_now}Z`) - Date.parse(`${codeNow}Z`)) / 60000;
    if (!(gapMinutes < 2)) {
      problems.push(`روی پایگاه‌داده‌ای به وقت تهران، defaultNow() مقدار ${res.rows[0]?.db_now} و toISOString مقدار ${codeNow} نوشت`);
    }
  } finally {
    await tehranDefault.end();
  }
  return problems;
}

/** آزمون‌های سخت‌گیرانه حوزه I برای سوئیت business_invariants: [شناسه، نام، بررسی، پیام قبولی]؛ جدیدترین اول */
export const DATE_BOUNDARY_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_314_session_clock_utc', 'v8.0.52: جلسه پایگاه‌داده با پارامترهای راه‌اندازی استخر UTC است، حتی وقتی پیش‌فرض پایگاه‌داده تهران باشد؛ defaultNow() هم‌وقتِ toISOString کد است (TD-314)',
    () => checkSessionClockUtc(), 'استخر TimeZone=UTC از پارامترهای راه‌اندازی؛ جلسه با پیش‌فرض تهران now() را به UTC نوشت'],
  ['inv_td_317_proforma_takes_invoice_number', 'v8.0.51: پیش‌فاکتور نهایی‌شده شماره بعدی سری فاکتور سال خودش را می‌گیرد، حتی وقتی شماره‌اش در فاکتورها هست؛ شماره پیش‌فاکتور در یادداشت می‌ماند (TD-317، گزینه الف)',
    checkProformaTakesInvoiceNumber, 'پیش‌فاکتور هم‌شماره فاکتور نهایی شد و شماره بعدی سری فاکتور ۱۳۹۸ را گرفت؛ کاردکس و یادداشت درست'],
  ['inv_td_313_document_dates_strict', 'v8.0.50: تاریخ ناموجود یا غیرتاریخ سند رد می‌شود، سال شماره‌گذاری از تاریخ ذخیره‌شده است و پیش‌نویسی که به سال دیگر برود شماره همان سال را می‌گیرد (TD-313، گزینه الف)',
    checkDocumentDatesStrict, '۳۰ اسفند ۱۳۹۶، ۳۰ فوریه و متن غیرتاریخ رد شدند؛ سند ۰۰:۱۵ نوروز در ۱۳۹۷؛ پیش‌نویس منتقل‌شده شماره یکتای ۱۳۹۷ گرفت'],
  ['inv_td_310_closing_covers_leap_last_day', 'v8.0.47: بستن سال مالی کبیسه سند ۳۰ اسفند را هم می‌بندد؛ اسناد اختتامیه به آخرین روز سال و افتتاحیه به ۱ فروردین صادر می‌شوند و تاریخ دیگر رد می‌شود (TD-310، گزینه الف)',
    () => checkClosingCoversLeapLastDay(), 'سود ۱٬۵۰۰٬۰۰۰ با فروش ۳۰ اسفند؛ اسناد به 2009-03-20 و 2009-03-21؛ ۲۹ اسفند رد شد؛ مانده درآمد سال صفر'],
];
