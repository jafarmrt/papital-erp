import type { DbExecutor } from '../../db/drizzle.js';
import { resolveDocumentTimestamp } from '../../lib/storageDate.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { DocumentRefNumberService } from './documentRefNumber.service.js';

export interface ProformaInvoiceTarget {
  /** تاریخ فاکتور: روز و ساعت نهایی‌سازی (ساعت توافقی کسب‌وکار) */
  date: string;
  /** شماره بعدی سری فاکتور سالِ تاریخ فاکتور */
  refNumber: string;
  /** یادداشت فاکتور: شماره و تاریخ پیش‌فاکتور */
  note: string;
}

/**
 * فاکتورِ حاصل از نهایی‌سازی پیش‌فاکتور.
 * - v8.0.51 (TD-317، تصمیم مالک محصول — گزینه الف): شماره بعدی سری فاکتور می‌گیرد و شماره پیش‌فاکتور در یادداشت می‌ماند.
 *   پیش‌تر شماره سری پیش‌فاکتور می‌ماند و اگر همان شماره در فاکتورهای آن سال بود، نهایی‌سازی با خطای یکتایی شکست می‌خورد.
 * - v8.0.119 (TD-410، تصمیم مالک محصول — گزینه الف): تاریخ روز نهایی‌سازی را می‌گیرد (گردش انبار، شماره و سال سری، سند
 *   حسابداری) و تاریخ پیش‌فاکتور در یادداشت می‌ماند. پیش‌تر تاریخ پیش‌فاکتور می‌ماند و فروشی که ماه‌ها بعد نهایی می‌شد در
 *   دوره صدور پیش‌فاکتور ثبت می‌شد (و اگر کالا پس از آن گردش داشت، قاعده تاریخ گردش کالا نهایی‌سازی را رد می‌کرد).
 */
export async function proformaInvoiceTarget(
  proforma: { date: string; refNumber: string | null },
  tx: DbExecutor
): Promise<ProformaInvoiceTarget> {
  const date = await resolveDocumentTimestamp(undefined, 'تاریخ فاکتور');
  const refNumber = await DocumentRefNumberService.getNextRef('invoice', date, tx);
  const proformaDate = isoToJalaliDate(String(proforma.date ?? '').slice(0, 10));
  const note = [
    proforma.refNumber ? `صادرشده از پیش‌فاکتور شماره ${proforma.refNumber}` : 'صادرشده از پیش‌فاکتور',
    proformaDate ? `به تاریخ ${proformaDate}` : '',
  ].filter(Boolean).join(' ');
  return { date, refNumber, note };
}

/**
 * v10.0.38 (TD-914، یافته P5-P05، تصمیم ت۹ الف): سفارش خریدی که تدارکات به انبار تحویل می‌دهد (تحویل سفارش و «دریافت
 * کالا») تاریخ روز تحویل را می‌گیرد، مانند پیش‌فاکتور (TD-410): گردش انبار، سند حسابداری و سال شماره. شماره سفارش می‌ماند
 * مگر روز تحویل در سال مالی دیگری باشد (آن‌گاه شماره بعدی سری همان سال، TD-313)؛ تاریخ سفارش در یادداشت می‌ماند. پیش‌تر سند
 * روز تبدیل به سفارش را داشت و هر گردش همان کالا میان این دو روز تحویل را برای هر کسی جز مدیر سامانه می‌بست (۴۲۲ تاریخ گذشته).
 */
export async function finalizeDayTarget(
  order: { type: string; date: string; refNumber: string | null; refFiscalYear: number | null },
  tx: DbExecutor
): Promise<ProformaInvoiceTarget> {
  const date = await resolveDocumentTimestamp(undefined, 'تاریخ تحویل');
  const sameYear = (order.refFiscalYear ?? resolveJalaliFiscalYear(order.date)) === resolveJalaliFiscalYear(date);
  const refNumber = sameYear && order.refNumber ? order.refNumber : await DocumentRefNumberService.getNextRef(order.type, date, tx);
  const orderDay = String(order.date ?? '').slice(0, 10);
  const note = orderDay && orderDay !== date.slice(0, 10)
    ? `تاریخ سفارش ${isoToJalaliDate(orderDay)}${refNumber !== order.refNumber && order.refNumber ? ` با شماره ${order.refNumber}` : ''}`
    : '';
  return { date, refNumber, note };
}
