import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * V7 Phase 4.2 (TD-169): ماژول مرجع شکست چرخه وابستگی اسکیماها (Schema DAG & Dependency Decoupler)
 * 
 * طبق ممیزی معماری نسخه ۷ و آنالیز Tarjan SCC، ماژول‌های ۵‌گانه اسکیما
 * (documents, inventory, projects, crm, personnel) به دلیل ارجاعات متقابل
 * در تعریف ستون‌ها دچار چرخه وابستگی دایره‌ای (Circular Import) بودند.
 * 
 * این ماژول امکان ارجاع تنبل (Lazy Reference Resolution) را بدون نیاز به ایمپورت مستقیم
 * و دایره‌ای فایل‌های اسکیما در یکدیگر فراهم می‌کند و گراف وابستگی را به یک DAG تبدیل می‌نماید.
 */

type ColumnRefGetter = () => AnyPgColumn;

const columnResolvers = new Map<string, ColumnRefGetter>();

/**
 * ثبت ستون جدول جهت ارجاع کلید خارجی توسط ماژول‌های دیگر بدون وابستگی مستقیم
 */
export function registerColumnRef(key: string, getter: ColumnRefGetter): void {
  columnResolvers.set(key, getter);
}

/**
 * سازنده تابع ارجاع تنبل برای استفاده در .references() دریزل
 */
export function schemaRef(key: string): () => AnyPgColumn {
  return () => {
    const resolver = columnResolvers.get(key);
    if (!resolver) {
      throw new Error(`[baseRelations] Schema reference '${key}' not registered yet.`);
    }
    return resolver();
  };
}

/**
 * کلیدهای ارجاعی مشترک پرکاربرد بین ماژول‌ها جهت شکستن چرخه وابستگی
 */
export const baseRelations = {
  // CRM
  customersId: schemaRef('customers.id'),
  crmLeadsId: schemaRef('crmLeads.id'),

  // Personnel
  personnelId: schemaRef('personnel.id'),
  pieceworkPayrollsId: schemaRef('pieceworkPayrolls.id'),

  // Projects
  productionProjectsId: schemaRef('productionProjects.id'),

  // Inventory
  itemsId: schemaRef('items.id'),
  transactionsId: schemaRef('transactions.id'),

  // Documents
  documentsId: schemaRef('documents.id'),

  // Accounting (v8.0.19، TD-271: پیوند سند حسابداری به چک در همان فایل اسکیما با ارجاع متقابل)
  chequesId: schemaRef('cheques.id'),
  // v8.0.34 (TD-286): پیوند سند حسابداری به تخصیص مواد BOM پروژه
  projectBomAllocationsId: schemaRef('projectBomAllocations.id'),

  // Procurement (v9.0.272، TD-691: پیوند سفارش خرید تدارکات به درخواست خرید)
  purchaseRequisitionsId: schemaRef('purchaseRequisitions.id'),
} as const;
