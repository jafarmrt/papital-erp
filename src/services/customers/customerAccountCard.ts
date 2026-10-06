import { NotFoundError } from '../../errors/customErrors.js';
import { AccountingReportService } from '../accounting/accountingReport.service.js';
import { CustomerService } from '../customer.service.js';

export type CustomerAccountCard = Awaited<ReturnType<typeof AccountingReportService.getDetailedAccountCard>>;

/**
 * v9.0.4 (TD-416، تصمیم مالک محصول ت۱ الف): کارت حساب طرف حساب با شناسه او — ردیف‌های مشتری و تأمین‌کننده همین
 * رکورد، و ردیف قدیمیِ بی‌شناسه فقط با نام دقیق کنونی. پیش‌تر صفحه طرف حساب‌ها فقط نام را می‌فرستاد و گزارش ردیف
 * هر طرف حسابی را که نامش این نام را داشت جمع می‌زد؛ پرونده مشتری نام را با شناسه AND می‌کرد و پس از تغییر نام
 * صفر نشان می‌داد.
 */
export async function getCustomerAccountCard(
  customerId: number,
  range: { startDate?: string; endDate?: string; currency?: string } = {}
): Promise<CustomerAccountCard> {
  const party = await CustomerService.getById(customerId);
  if (!party) throw new NotFoundError('طرف حساب یافت نشد.');
  return AccountingReportService.getDetailedAccountCard({ party: { id: party.id, legacyName: party.name }, ...range });
}
