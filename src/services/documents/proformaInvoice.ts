import type { DbExecutor } from '../../db/drizzle.js';
import { resolveDocumentTimestamp } from '../../lib/storageDate.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { proformaInvoiceNote } from '../../lib/documents/proformaInvoiceNote.js';
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
  const note = proformaInvoiceNote(proforma.refNumber, proformaDate);
  return { date, refNumber, note };
}
