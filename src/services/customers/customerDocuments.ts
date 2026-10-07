import { NotFoundError } from '../../errors/customErrors.js';
import { DocumentService } from '../document.service.js';
import { CustomerService } from '../customer.service.js';
import type { PaginatedDocumentsResult } from '../documents/types.js';

/** نوع‌های فروش: فاکتور (پیش‌نویس، پیش‌فاکتور و نهایی)، پیش‌فاکتور قدیمی و برگشت از فروش */
export const SALES_DOCUMENT_TYPES = ['invoice', 'proforma', 'return'];

/**
 * v9.0.6 (TD-417، تصمیم مالک محصول ت۱ الف): اسناد پرونده مشتری فقط سندهای فروشی‌اند که نام خریدارشان دقیقاً نام کنونی
 * طرف حساب است. پیش‌تر با جست‌وجوی «شامل» روی شماره، خریدار، یادداشت، کاربر، تلفن و شهر پر می‌شد و اسناد خریدار دیگر،
 * سندهایی که نام در یادداشتشان بود و رسید و حواله انبار را هم نشان می‌داد.
 */
export async function getCustomerSalesDocuments(customerId: number, page = 1, limit = 50): Promise<PaginatedDocumentsResult> {
  const party = await CustomerService.getById(customerId);
  if (!party) throw new NotFoundError('طرف حساب یافت نشد.');
  // v9.0.287 (TD-778، تصمیم ت۶ الف): سند با شناسه طرف حساب (نام سند فقط نمایش است)؛ سند پیشین بی شناسه با نام برابر
  return await DocumentService.getDocuments({ party: { id: party.id, legacyName: party.name }, types: SALES_DOCUMENT_TYPES, page, limit }) as PaginatedDocumentsResult;
}
