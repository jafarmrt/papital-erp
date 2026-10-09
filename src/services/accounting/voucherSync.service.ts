import { orm, type DbExecutor } from '../../db/drizzle.js';
import { 
  documents, 
  documentItems, 
  journalVouchers, 
  personnel, 
  pieceworkPayrolls, 
  items, 
  productionProjects,
  appSettings,
  transactions
} from '../../db/schema.js';
import { eq, and, inArray, isNull, gt, asc, notLike } from 'drizzle-orm';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { VoucherService } from './voucher.service.js';
import { payrollVouchersWhere, pickPayrollVoucher } from './payrollVoucherLink.js';
import { AccountMappingService } from './accountMapping.service.js';
import { logger } from '../../middleware/logger.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { salesReturnKardexUnitCosts } from '../documents/salesReturnCost.js';
import { documentVoucherPartyId } from '../documents/documentParty.js';
import { kardexInCostByItem } from './productionReceiptCost.js';
import { documentOutflowCost } from './outflowVoucherCost.js';
import { balancedCostRows, irrToForeignAmount, rateForRial, rowExchangeRate } from './foreignCostRow.js';
import { ValidationError, NotFoundError } from '../../errors/customErrors.js';
import type { JournalVoucher } from '../../types.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';

/** انواع اسنادی که VoucherSync برایشان سند حسابداری خودکار صادر می‌کند */
export const AUTO_VOUCHER_DOC_TYPES = ['invoice', 'receipt', 'production_receipt', 'purchase', 'remittance', 'waste', 'return'] as const;

/**
 * پیشوند شماره مرجع اسنادی که از روی یک سند حسابداری دیگر ساخته می‌شوند (معکوس، اصلاحی، ابطال و ثبت مجدد)
 * و reference_id آن‌ها شناسه سند حسابداری مبدأ است نه شناسه سند انبار (v7.0.31 / TD-193).
 */
export const DERIVED_VOUCHER_REF_PREFIXES = ['REV-V', 'RE-REV-V', 'CORR-V', 'VOID-REPOST-V', 'REPOST-V'] as const;

export interface MissingDocumentVoucherSyncSummary {
  /** true یعنی اجرای دیگری در خوشه در جریان است و این فراخوان کاری انجام نداد */
  locked: boolean;
  checked: number;
  created: number;
  failed: number;
  /** اسنادی که سند حسابداری بدون پیوند (قدیمی/دستی) دارند و برای جلوگیری از ثبت دوباره به بررسی حسابدار سپرده شدند */
  skippedForReview: number;
  errors: Array<{ documentId: number; message: string }>;
  reviewDocumentIds: number[];
}

export class VoucherSyncService {
  /**
   * v7.0.63 (TD-198): نرخ تسعیر سند حسابداری یک سند ارزی. ترتیب: نرخ صریح فراخواننده، ستون documents.exchange_rate،
   * کلید تنظیمات exchange_rate_<ارز> (سازگاری اسناد قدیمی). دیگر هیچ نرخی از متن یادداشت خوانده نمی‌شود و در نبود
   * نرخ، سند حسابداری با نرخ ۱ صادر نمی‌شود.
   */
  static async resolveVoucherExchangeRate(
    executor: DbExecutor,
    doc: { currency?: string | null; exchangeRate?: DecimalValue; refNumber?: string | null },
    explicitRate?: DecimalValue
  ): Promise<FinancialDecimal> {
    const currency = (doc.currency || 'IRR').toUpperCase();
    if (currency === 'IRR') return fin(1);
    // v7.0.68 (P2-6): نرخ بدون عبور از double
    if (explicitRate !== undefined && fin(explicitRate).isPositive()) return fin(explicitRate);
    if (fin(doc.exchangeRate).isPositive()) return fin(doc.exchangeRate);
    const [settingRow] = await executor.select().from(appSettings)
      .where(eq(appSettings.key, `exchange_rate_${currency.toLowerCase()}`));
    if (settingRow && fin(settingRow.value as DecimalValue).isPositive()) return fin(settingRow.value as DecimalValue);
    throw new ValidationError(`نرخ تسعیر سند ارزی ${doc.refNumber ?? ''} (${currency}) ثبت نشده است؛ سند حسابداری با نرخ ۱ صادر نمی‌شود.`);
  }

  /**
   * Automatic Double-Entry Journal Voucher for Sales Invoices
   */
  static async syncSalesInvoiceVoucher(docId: number, options?: {
    exchangeRate?: number;
    userId?: number;
    username?: string;
    strict?: boolean;
  }, tx?: DbExecutor): Promise<JournalVoucher | null> {
    // P2-04: پیش‌فرض قرار دادن حالت Strict برای تضمین کامل ردپای حسابداری اسناد نهایی
    const isStrict = options?.strict !== false;
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, docId));
    if (!doc || doc.isDeleted === 1 || (doc.type !== 'invoice' && doc.type !== 'proforma') || doc.status !== 'final') {
      if (isStrict) {
        throw new ValidationError(`فاکتور فروش با شناسه ${docId} نامعتبر، حذف‌شده، یا نهایی‌نشده است.`);
      }
      return null;
    }

    const itemsList = await executor.select({
      id: documentItems.id,
      itemId: documentItems.itemId,
      quantity: documentItems.quantity,
      unitPrice: documentItems.unitPrice,
      discount: documentItems.discount,
      location: documentItems.location,
      itemCode: items.code,
      itemName: items.name,
      itemType: items.type,
      weightedAverageCost: items.weightedAverageCost,
      currentStock: items.currentStock
    })
    .from(documentItems)
    .leftJoin(items, eq(documentItems.itemId, items.id))
    .where(and(eq(documentItems.documentId, docId), eq(documentItems.isDeleted, 0)));

    if (!itemsList || itemsList.length === 0) {
      if (isStrict) {
        throw new ValidationError(`فاکتور فروش شماره «${doc.refNumber}» فاقد هرگونه قلم کالا برای صدور سند حسابداری است.`);
      }
      return null;
    }

    // V9-1.3: جمع مبالغ با FinancialDecimal — حذف خطای شناور float در مبالغ بزرگ ریالی
    let grossAmount = fin(0);
    let totalDiscount = fin(0);

    // v7.0.68 (P2-6): مبالغ اقلام بدون عبور از double
    for (const it of itemsList) {
      grossAmount = grossAmount.add(fin(it.quantity).multiply(it.unitPrice));
      totalDiscount = totalDiscount.add(it.discount);
    }

    const grossAmountNum = grossAmount.round(4);
    const totalDiscountNum = totalDiscount.round(4);

    // v9.0.270 (TD-772، تصمیم ت۳ «الف» بسته ۸): فاکتور با جمع ناخالص صفر (نمونه رایگان، هدیه) هم سند می‌گیرد: بهای
    // تمام‌شده به بهای کاردکس «بدهکار ۶۰۰۱ / بستانکار موجودی» و درآمد صفر، مثل فاکتوری که یک ردیف رایگان دارد. پیش‌تر
    // این‌جا بی سند برمی‌گشت و کالای خارج‌شده هرگز از حساب موجودی کم نمی‌شد (B08-03). ردیف صفر نوشته نمی‌شود.

    const netAmountRaw = grossAmountNum.subtract(totalDiscountNum);
    const netAmount = netAmountRaw.isNegative() ? fin(0) : netAmountRaw.round(4);

    // v7.0.32 (TD-197 / audit P1-7): مبلغ مالیات فقط از ستون ساختاریافته خود فاکتور خوانده می‌شود. پیش‌تر از
    // متن آزاد یادداشت با Regex استخراج می‌شد و یادداشتی مانند «مالیات ۲ قلم آخر محاسبه نشود» مالیات ۲ ریالی
    // در دفاتر ثبت می‌کرد که در خود فاکتور وجود نداشت.
    const vatAmount = fin(doc.vatAmount).round(4);

    // v7.0.103 (TD-191): هزینه ارسال و کارمزد ساختاریافته فاکتور (سفارش ووکامرس) جزء مبلغ قابل وصول است
    const serviceChargeAmount = fin(doc.serviceChargeAmount).round(4);

    const finalPayable = netAmount.add(vatAmount).add(serviceChargeAmount).round(4);

    // Conceptual Account Resolution (Subphase 9.2 + V5.0.17 TD-120)
    const customerAcc = await AccountMappingService.getTradeReceivablesAccount(tx);
    const discountAcc = await AccountMappingService.getSalesDiscountAccount(tx);
    const revenueAcc = await AccountMappingService.getSalesRevenueAccount(tx);
    const vatAcc = await AccountMappingService.getSalesVatPayableAccount(tx);
    const serviceAcc = serviceChargeAmount.isPositive() ? await AccountMappingService.getServiceRevenueAccount(tx) : null;
    const cogsAcc = await AccountMappingService.getCostOfGoodsSoldAccount(tx);
    const fgAcc = await AccountMappingService.getInventoryFinishedGoodsAccount(tx);
    const rmAcc = await AccountMappingService.getInventoryRawMaterialsAccount(tx);

    if (!customerAcc || !revenueAcc) {
      const missingAccounts = [
        !customerAcc && 'حساب‌های دریافتنی (1201)',
        !revenueAcc && 'درآمد فروش (5001)'
      ].filter(Boolean).join('، ');
      logger.warn({ message: `Standard customer or revenue accounts not found for invoice auto voucher: ${missingAccounts}` });
      if (isStrict) {
        throw new ValidationError(`سرفصل‌های حسابداری متناظر برای صدور سند فاکتور فروش شماره «${doc.refNumber}» یافت نشد (${missingAccounts}) — لطفاً از تنظیمات حسابداری پیکربندی نمایید.`);
      }
      return null;
    }

    // TD-120 & AUD-04: اعتبارسنجی تراز بودن سند در نبود سرفصل تخفیف یا ارزش افزوده
    if (totalDiscountNum.isPositive() && !discountAcc) {
      if (isStrict) {
        throw new ValidationError('سرفصل حسابداری تخفیفات اعطایی (۵۱۰۲) در تنظیمات حسابداری تعریف نشده است.');
      }
      logger.warn({ message: `Discount account not found for invoice ${doc.refNumber}, skipping auto voucher to prevent unbalanced entry` });
      return null;
    }

    if (vatAmount.isPositive() && !vatAcc) {
      if (isStrict) {
        throw new ValidationError('سرفصل حسابداری مالیات بر ارزش افزوده (۳۲۰۳) در تنظیمات حسابداری تعریف نشده است.');
      }
      logger.warn({ message: `VAT account not found for invoice ${doc.refNumber}, skipping auto voucher to prevent unbalanced entry` });
      return null;
    }

    if (serviceChargeAmount.isPositive() && !serviceAcc) {
      if (isStrict) {
        throw new ValidationError('سرفصل حسابداری درآمد حمل و خدمات (۵۰۰۴) در تنظیمات حسابداری تعریف نشده است.');
      }
      logger.warn({ message: `Service revenue account not found for invoice ${doc.refNumber}, skipping auto voucher to prevent unbalanced entry` });
      return null;
    }

    // v9.0.336 (TD-778، تصمیم ت۶ الف): طرف حساب از شناسه سند؛ سند پیشین بی شناسه با برابری دقیق نام
    const matchedCustomerId = await documentVoucherPartyId(executor, doc);

    // V10-1.1 & V5.0.17: fallback تاریخ ۱۰ کاراکتری ایمن
    const docDate = doc.date ? String(doc.date).slice(0, 10) : await businessTodayIsoDate();

    // V6.0.4 (TD-143) / v7.0.63 (TD-198): نرخ تسعیر فاکتور ارزی از ستون ساختاریافته سند
    const docCurrency = (doc.currency || 'IRR').toUpperCase();
    const exchangeRate = await VoucherSyncService.resolveVoucherExchangeRate(executor, doc, options?.exchangeRate);

    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency?: string;
      exchangeRate?: DecimalValue;
      description?: string;
    }[] = [];

    // ۱) بدهکار: حساب‌های دریافتنی تجاری (مشتری)
    if (finalPayable.isPositive()) voucherItems.push({
      accountId: customerAcc.id,
      detailedType: 'customer',
      detailedId: matchedCustomerId || undefined,
      detailedName: doc.buyerName || 'مشتری فاکتور',
      debit: finalPayable,
      credit: 0,
      currency: doc.currency || 'IRR',
      exchangeRate: exchangeRate,
      description: `حساب‌های دریافتنی بابت فاکتور فروش شماره ${doc.refNumber}${doc.buyerName ? ` - ${doc.buyerName}` : ''}`
    });

    // ۲) بدهکار: تخفیفات اعطایی
    if (totalDiscountNum.isPositive() && discountAcc) {
      voucherItems.push({
        accountId: discountAcc.id,
        detailedType: 'other',
        detailedName: 'تخفیفات اعطایی',
        debit: totalDiscountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        exchangeRate: exchangeRate,
        description: `تخفیفات اعطایی فاکتور فروش شماره ${doc.refNumber}`
      });
    }

    // ۳) بستانکار: درآمد فروش محصولات
    if (grossAmountNum.isPositive()) voucherItems.push({
      accountId: revenueAcc.id,
      detailedType: 'other',
      detailedName: 'درآمد فروش محصولات',
      debit: 0,
      credit: grossAmountNum,
      currency: doc.currency || 'IRR',
      exchangeRate: exchangeRate,
      description: `درآمد فروش ناخالص فاکتور شماره ${doc.refNumber}`
    });

    // ۴) بستانکار: مالیات بر ارزش افزوده
    if (vatAmount.isPositive() && vatAcc) {
      voucherItems.push({
        accountId: vatAcc.id,
        detailedType: 'other',
        detailedName: 'مالیات بر ارزش افزوده',
        debit: 0,
        credit: vatAmount,
        currency: doc.currency || 'IRR',
        exchangeRate: exchangeRate,
        description: `مالیات و عوارض بر ارزش افزوده فاکتور شماره ${doc.refNumber}`
      });
    }

    // ۴-ب) v7.0.103 (TD-191): بستانکار: درآمد حمل و خدمات (هزینه ارسال و کارمزد سفارش)
    if (serviceChargeAmount.isPositive() && serviceAcc) {
      voucherItems.push({
        accountId: serviceAcc.id,
        detailedType: 'other',
        detailedName: 'درآمد حمل و خدمات',
        debit: 0,
        credit: serviceChargeAmount,
        currency: doc.currency || 'IRR',
        exchangeRate: exchangeRate,
        description: `هزینه ارسال و خدمات فاکتور شماره ${doc.refNumber}`
      });
    }

    // ۵) V5.0.17 (TD-120), V6.0.4 (TD-143) & P1-02 (H-01): ثبت ردیف‌های بهای تمام‌شده کالای فروش‌رفته (COGS) و کسر متناظر موجودی انبار بر پایه بهای تمام‌شده تاریخی خروج
    const docTxs = await executor.select({
      itemId: transactions.itemId,
      unitPrice: transactions.unitPrice,
    }).from(transactions)
      .where(and(
        eq(transactions.documentId, docId),
        eq(transactions.type, 'out'),
        eq(transactions.isDeleted, 0)
      ));
    const txCostMap = new Map<number, FinancialDecimal>();
    for (const t of docTxs) {
      if (fin(t.unitPrice).isPositive()) {
        txCostMap.set(t.itemId, fin(t.unitPrice));
      }
    }

    let fgCost = fin(0);
    let rmCost = fin(0);
    for (const line of itemsList) {
      const q = Number(line.quantity) || 0;
      const historicalCost = txCostMap.get(line.itemId);
      const wac = historicalCost !== undefined
        ? historicalCost
        : fin(line.weightedAverageCost); // fallback to current WAC if no tx recorded
      const lineCost = fin(q).multiply(wac);
      if (line.itemType === 'product') {
        fgCost = fgCost.add(lineCost);
      } else {
        rmCost = rmCost.add(lineCost);
      }
    }

    // TD-143 / v8.0.18 (TD-261): بهای ریالی کاردکس در فاکتور ارزی به ارز سند، با نرخ همان ردیف تا معادل ریالی ردیف دقیقاً
    // همان بهای کاردکس باشد (foreignCostRow)؛ بهای تمام‌شده جمع دو ردیف موجودی است تا سند ارزی تراز بماند
    // v10.0.12 (TD-1030): each inventory row is worth its cost rounded to the rial and cost of sales exactly their sum, so the
    // voucher balances in rials too (before, 4-decimal amounts and rates left it one rial out and the year closing refused it)
    const { parts: [fgRow, rmRow], total: cogsRow } = balancedCostRows([fgCost, rmCost], exchangeRate);
    const fgCostNum = fgRow.amount;
    const rmCostNum = rmRow.amount;
    const totalCogsNum = cogsRow.amount;
    const cogsRate = cogsRow.exchangeRate;

    if (totalCogsNum.isPositive()) {
      if (!cogsAcc || (fgCostNum.isPositive() && !fgAcc) || (rmCostNum.isPositive() && !rmAcc)) {
        if (isStrict) {
          throw new ValidationError('سرفصل بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱) یا حساب‌های موجودی کالا در تنظیمات حسابداری تعریف نشده است.');
        }
      } else {
        // ۵-الف) بدهکار: بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱)
        voucherItems.push({
          accountId: cogsAcc.id,
          detailedType: 'other',
          detailedName: 'بهای تمام‌شده کالای فروش‌رفته',
          debit: totalCogsNum,
          credit: 0,
          currency: doc.currency || 'IRR',
          exchangeRate: cogsRate,
          description: `بهای تمام‌شده فاکتور فروش شماره ${doc.refNumber}${docCurrency !== 'IRR' ? ` (بهای ریالی کاردکس با نرخ ردیف ${cogsRate})` : ''}`
        });

        // ۵-ب) بستانکار: کاهش موجودی کالای تولیدشده (۱۴۰۳)
        if (fgCostNum.isPositive() && fgAcc) {
          voucherItems.push({
            accountId: fgAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی کالای ساخته‌شده',
            debit: 0,
            credit: fgCostNum,
            currency: doc.currency || 'IRR',
            exchangeRate: fgRow.exchangeRate,
            description: `کاهش موجودی کالای ساخته‌شده بابت فاکتور فروش شماره ${doc.refNumber}`
          });
        }

        // ۵-ج) بستانکار: کاهش موجودی مواد اولیه (۱۴۰۱)
        if (rmCostNum.isPositive() && rmAcc) {
          voucherItems.push({
            accountId: rmAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی مواد اولیه',
            debit: 0,
            credit: rmCostNum,
            currency: doc.currency || 'IRR',
            exchangeRate: rmRow.exchangeRate,
            description: `کاهش موجودی مواد اولیه بابت فاکتور فروش شماره ${doc.refNumber}`
          });
        }
      }
    }

    // فاکتوری که نه مبلغ دارد نه بهای کاردکس، چیزی برای ثبت ندارد
    if (voucherItems.length === 0) return null;

    // v7.0.31 (TD-193 / P1-8): یافتن سند حسابداری فاکتور فقط از پیوند صریح source_document_id؛
    // reference_id در اسناد معکوس/اصلاحی شناسه سند حسابداری مبدأ است و با شناسه اسناد انبار تداخل دارد.
    const [existingVoucher] = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.sourceDocumentId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));

    let resultVoucher: JournalVoucher | null = null;
    if (existingVoucher) {
      // P1-02 (H-01): اسناد تاییدشده و قطعی هرگز نباید با بهای تمام‌شده روز بازنویسی شوند
      if (existingVoucher.status === 'permanent' || existingVoucher.status === 'approved') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      resultVoucher = await VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType: 'sales',
        description: `ثبت فاکتور فروش شماره ${doc.refNumber} به نام ${doc.buyerName || 'مشتری'}${totalDiscountNum.isPositive() ? ' (همراه با تخفیف)' : ''}${vatAmount.isPositive() ? ' (شامل ارزش‌افزوده)' : ''}`,
        items: voucherItems,
      }, tx);
    } else {
      resultVoucher = await VoucherService.createJournalVoucher({
        date: docDate,
        voucherType: 'sales',
        status: 'draft',
        description: `ثبت فاکتور فروش شماره ${doc.refNumber} به نام ${doc.buyerName || 'مشتری'}${totalDiscountNum.isPositive() ? ' (همراه با تخفیف)' : ''}${vatAmount.isPositive() ? ' (شامل ارزش‌افزوده)' : ''}`,
        referenceModule: 'invoice',
        referenceId: docId,
        referenceNumber: doc.refNumber,
        sourceDocumentId: docId,
        currency: doc.currency || 'IRR',
        userId: options?.userId,
        username: options?.username,
        items: voucherItems
      }, tx);
    }

    if (!resultVoucher && isStrict) {
      throw new ValidationError(`صدور سند خودکار حسابداری برای فاکتور فروش شماره «${doc.refNumber}» ناموفق بود.`);
    }

    return resultVoucher;
  }

  /**
   * Auto-generate/sync double-entry voucher for purchase invoices / receipts (خرید مواد/کالا و رسید تولید محصولات)
   */
  static async syncPurchaseInvoiceVoucher(docId: number, options?: {
    userId?: number;
    username?: string;
    exchangeRate?: number;
    strict?: boolean;
  }, tx?: DbExecutor): Promise<JournalVoucher | null> {
    // P2-04: پیش‌فرض قرار دادن حالت Strict برای صدور سند خرید/رسید
    const isStrict = options?.strict !== false;
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, docId));
    if (!doc || doc.isDeleted === 1 || !['receipt', 'production_receipt', 'purchase'].includes(doc.type) || doc.status !== 'final') {
      if (isStrict) {
        throw new ValidationError(`سند خرید/رسید با شناسه ${docId} نامعتبر، حذف‌شده، یا نهایی‌نشده است.`);
      }
      return null;
    }

    const itemsList = await executor.select({
      id: documentItems.id,
      itemId: documentItems.itemId,
      quantity: documentItems.quantity,
      unitPrice: documentItems.unitPrice,
      discount: documentItems.discount,
      location: documentItems.location,
      name: items.name,
      code: items.code,
      unit: items.unit,
      itemType: items.type,
      category: items.category,
      weightedAverageCost: items.weightedAverageCost,
    })
    .from(documentItems)
    .leftJoin(items, eq(documentItems.itemId, items.id))
    .where(and(eq(documentItems.documentId, docId), eq(documentItems.isDeleted, 0)));

    if (!itemsList || itemsList.length === 0) {
      if (isStrict) {
        throw new ValidationError(`سند خرید/رسید شماره «${doc.refNumber}» فاقد هرگونه قلم کالا برای صدور سند حسابداری است.`);
      }
      return null;
    }

    // V9-1.3: جمع مبالغ با FinancialDecimal. هر ردیف موجودی دو بخش دارد: بخش بها‌دار به ارز سند (ردیف‌های قیمت‌دار) و
    // بخش ریالی کاردکس (رسید تولید با قیمت صفر، کالای رایگان) — v8.0.18 (TD-261)
    const isProductionDoc = doc.type === 'production_receipt';
    const inventoryParts = { raw: { doc: fin(0), irr: fin(0) }, finished: { doc: fin(0), irr: fin(0) } };
    const partOf = (it: typeof itemsList[number]) =>
      (it.itemType === 'product' || (it.itemType !== 'raw_material' && isProductionDoc) ? inventoryParts.finished : inventoryParts.raw);
    const addPriced = (it: typeof itemsList[number], amount: FinancialDecimal) => { const part = partOf(it); part.doc = part.doc.add(amount); };
    const addKardexIrr = (it: typeof itemsList[number], irr: FinancialDecimal) => { const part = partOf(it); part.irr = part.irr.add(irr); };

    // V6.0.4 (TD-143) / v7.0.63 (TD-198): نرخ تسعیر فاکتور خرید ارزی از ستون ساختاریافته سند (ریالی = ۱)
    const exchangeRate = await VoucherSyncService.resolveVoucherExchangeRate(executor, doc, options?.exchangeRate);
    const lineNetOf = (it: typeof itemsList[number], unitPrice: DecimalValue) => {
      const net = fin(it.quantity).multiply(unitPrice).subtract(it.discount);
      return net.isNegative() ? fin(0) : net;
    };

    // v8.0.12 (TD-256) / v8.0.17 (TD-268): کالایی که ردیف بی‌بها دارد — رسید تولید با قیمت صفر، یا کالای رایگان رسید و
    // خرید (خالص ردیف صفر) — به بهای ثبت‌شده در کاردکس همین سند (WAC لحظه ورود)
    const isFreeLine = (it: typeof itemsList[number]) =>
      (isProductionDoc ? !fin(it.unitPrice).isPositive() : !lineNetOf(it, it.unitPrice).isPositive());
    const freeItemIds = [...new Set(itemsList.filter(it => it.itemId !== null && isFreeLine(it)).map(it => Number(it.itemId)))];
    const kardexCostByItem = await kardexInCostByItem(executor, docId, freeItemIds);
    const kardexCostedItems = new Set<number>();
    const pricedNetByItem = new Map<number, FinancialDecimal>();

    for (const it of itemsList) {
      const itemId = Number(it.itemId);
      const kardexCost = kardexCostByItem.get(itemId);
      if (isProductionDoc && kardexCost) {
        if (!kardexCostedItems.has(itemId)) {
          kardexCostedItems.add(itemId);
          addKardexIrr(it, kardexCost);
        }
        continue;
      }
      // P1-03 (M-06): در رسیدهای خرید قیمت واقعی فاکتور ثبت می‌شود؛ فال‌بک به WAC فقط مختص رسیدهای تولید است
      const p = isProductionDoc && !fin(it.unitPrice).isPositive() ? fin(it.weightedAverageCost) : fin(it.unitPrice);
      const lineNet = lineNetOf(it, p);
      addPriced(it, lineNet);
      if (kardexCost) pricedNetByItem.set(itemId, (pricedNetByItem.get(itemId) ?? fin(0)).add(lineNet));
    }

    // v8.0.17 (TD-268، تصمیم مالک محصول — گزینه ب): کالای رایگان رسید و خرید به WAC وارد انبار شده است؛ همان ارزش
    // (بهای کاردکس کالا منهای ردیف‌های بها‌دار همان کالا) بدهکار موجودی و بستانکار «درآمد کالای اهدایی» می‌شود.
    // پیش‌تر سندی برایش صادر نمی‌شد و ارزش انبار از دفتر کل بیشتر می‌شد.
    let freeGoodsIrr = fin(0);
    if (!isProductionDoc) {
      for (const [itemId, kardexCost] of kardexCostByItem) {
        const free = kardexCost.subtract((pricedNetByItem.get(itemId) ?? fin(0)).multiply(exchangeRate));
        const line = itemsList.find(l => Number(l.itemId) === itemId);
        if (!line || !free.isPositive()) continue;
        addKardexIrr(line, free);
        freeGoodsIrr = freeGoodsIrr.add(free);
      }
    }

    // v8.0.18 (TD-261، تصمیم مالک محصول — گزینه ب): بخش ریالی کاردکس به ارز سند (۴ رقم اعشار) و نرخ هر ردیف = ارزش
    // ریالی کل ردیف ÷ مبلغ ارزی آن، تا معادل ریالی ردیف دقیقاً همان ارزش کاردکس باشد؛ در سند ریالی نرخ همان ۱ است
    const kardexForeign = {
      raw: irrToForeignAmount(inventoryParts.raw.irr, exchangeRate),
      finished: irrToForeignAmount(inventoryParts.finished.irr, exchangeRate),
    };
    const rawMaterialsAmountNum = inventoryParts.raw.doc.add(kardexForeign.raw).round(4);
    const finishedGoodsAmountNum = inventoryParts.finished.doc.add(kardexForeign.finished).round(4);
    const rawMaterialsIrr = inventoryParts.raw.doc.multiply(exchangeRate).add(inventoryParts.raw.irr);
    const finishedGoodsIrr = inventoryParts.finished.doc.multiply(exchangeRate).add(inventoryParts.finished.irr);
    // v10.0.12 (TD-1030): each inventory row is worth its value rounded to the rial, and the opposite rows (work in progress,
    // or the supplier at the document rate plus donated goods) exactly their sum, so the voucher balances in rials too
    const rawMaterialsRial = rawMaterialsIrr.round(0);
    const finishedGoodsRial = finishedGoodsIrr.round(0);
    const rawMaterialsRate = rateForRial(rawMaterialsAmountNum, rawMaterialsRial, exchangeRate);
    const finishedGoodsRate = rateForRial(finishedGoodsAmountNum, finishedGoodsRial, exchangeRate);
    // کالای رایگان (رسید و خرید): مبلغ ارزی همان بخش کاردکس دو ردیف موجودی، تا سند ارزی تراز بماند
    const freeGoodsAmountNum = isProductionDoc ? fin(0) : kardexForeign.raw.add(kardexForeign.finished).round(4);

    const totalGross = fin(rawMaterialsAmountNum).add(finishedGoodsAmountNum).round(4);
    if (!totalGross.isPositive()) return null;
    const inventoryRial = (rawMaterialsAmountNum.isPositive() ? rawMaterialsRial : fin(0)).add(finishedGoodsAmountNum.isPositive() ? finishedGoodsRial : fin(0));
    const totalGrossRate = rateForRial(totalGross, inventoryRial, exchangeRate);
    const supplierRial = totalGross.subtract(freeGoodsAmountNum).round(4).multiply(exchangeRate).round(0);
    const freeGoodsRate = freeGoodsAmountNum.isPositive()
      ? rateForRial(freeGoodsAmountNum, inventoryRial.subtract(supplierRial), exchangeRate)
      : rowExchangeRate(freeGoodsIrr, freeGoodsAmountNum, exchangeRate);

    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    // v9.0.199 (TD-550، B03-08): پشتیبان فقط کد معین پیش‌فرض است، هرگز حساب کل (۱۴، ۳۰ و …)
    // v8.0.14 (TD-259): سرفصل‌ها از نگاشت حساب‌ها، مانند سند فروش و حواله؛ پیش‌تر کد ثابت ۱۴۰۱/۱۴۰۲/۱۴۰۳/۳۰۰۱ بود و با
    // نگاشت سفارشی، خرید و فروش یک کالا به دو حساب موجودی می‌رفتند. کد پیش‌فرض فقط وقتی است که حساب نگاشت‌شده نباشد.
    const rawMaterialAcc = (await AccountMappingService.getInventoryRawMaterialsAccount(tx)) || allAccs.find(a => a.code === '1401');
    const wipAcc = (await AccountMappingService.getWorkInProgressAccount(tx)) || allAccs.find(a => a.code === '1402');
    const finishedGoodsAcc = (await AccountMappingService.getInventoryFinishedGoodsAccount(tx)) || allAccs.find(a => a.code === '1403');
    const supplierAcc = (await AccountMappingService.getTradePayablesAccount(tx)) || allAccs.find(a => a.code === '3001');

    // v9.0.336 (TD-778): تأمین‌کننده از شناسه سند؛ سند پیشین بی شناسه با برابری دقیق نام
    const matchedSupplierId = doc.type !== 'production_receipt' ? await documentVoucherPartyId(executor, doc) : null;

    let matchedProjectId: number | null = doc.projectId ? Number(doc.projectId) : null;
    let matchedProjectName: string = '';
    if (matchedProjectId) {
      const [p] = await executor.select().from(productionProjects).where(and(eq(productionProjects.id, matchedProjectId), eq(productionProjects.isDeleted, 0)));
      if (p) {
        matchedProjectName = p.title || p.projectCode;
      }
    } else if (doc.notes) {
      const matchProj = String(doc.notes).match(/پروژه\s*[:#]?\s*([A-Za-z0-9-_]+)/i);
      if (matchProj && matchProj[1]) {
        const [p] = await executor.select().from(productionProjects).where(and(eq(productionProjects.projectCode, matchProj[1].trim()), eq(productionProjects.isDeleted, 0)));
        if (p) {
          matchedProjectId = p.id;
          matchedProjectName = p.title || p.projectCode;
        }
      }
    }

    // V10-1.1 & V5.0.17: fallback تاریخ ۱۰ کاراکتری ایمن
    const docDate = doc.date ? String(doc.date).slice(0, 10) : await businessTodayIsoDate();

    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'supplier' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency?: string;
      exchangeRate?: DecimalValue;
      description?: string;
    }[] = [];

    // Debit 1: Raw Materials
    if (rawMaterialsAmountNum.isPositive() && rawMaterialAcc) {
      voucherItems.push({
        accountId: rawMaterialAcc.id,
        detailedType: 'other',
        detailedName: 'موجودی مواد اولیه و ملزومات',
        debit: rawMaterialsAmountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        exchangeRate: rawMaterialsRate,
        description: `ورود مواد اولیه و ملزومات بابت ${isProductionDoc ? 'رسید تولید' : 'رسید/فاکتور خرید'} شماره ${doc.refNumber}`
      });
    }

    // Debit 2: Finished Goods
    if (finishedGoodsAmountNum.isPositive() && finishedGoodsAcc) {
      voucherItems.push({
        accountId: finishedGoodsAcc.id,
        detailedType: 'other',
        detailedName: 'موجودی محصولات نهایی و کالای ساخته‌شده',
        debit: finishedGoodsAmountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        exchangeRate: finishedGoodsRate,
        description: `ورود محصولات ساخته‌شده بابت ${isProductionDoc ? 'رسید تولید' : 'رسید ورود کالا'} شماره ${doc.refNumber}${matchedProjectName ? ` (پروژه: ${matchedProjectName})` : ''}`
      });
    }

    // Credit side
    if (isProductionDoc) {
      if (wipAcc) {
        voucherItems.push({
          accountId: wipAcc.id,
          detailedType: matchedProjectId ? 'project' : 'other',
          detailedId: matchedProjectId || undefined,
          detailedName: matchedProjectName || (doc.buyerName || 'خط تولید / کالای در جریان ساخت'),
          debit: 0,
          credit: totalGross,
          currency: doc.currency || 'IRR',
          exchangeRate: totalGrossRate,
          description: `انتقال بهای تمام شده از کالای در جریان ساخت به انبار بابت رسید تولید شماره ${doc.refNumber}${matchedProjectName ? ` (پروژه: ${matchedProjectName})` : ''}`
        });
      }
    } else {
      const supplierAmount = totalGross.subtract(freeGoodsAmountNum).round(4);
      if (supplierAmount.isPositive() && supplierAcc) {
        voucherItems.push({
          accountId: supplierAcc.id,
          detailedType: 'supplier',
          detailedId: matchedSupplierId || undefined,
          detailedName: doc.buyerName || 'تامین‌کننده',
          debit: 0,
          credit: supplierAmount,
          currency: doc.currency || 'IRR',
          exchangeRate,
          description: `بستانکاری تامین‌کننده بابت فاکتور خرید / رسید ورود کالا و مواد شماره ${doc.refNumber}`
        });
      } else if (supplierAmount.isPositive() && isStrict) {
        throw new ValidationError('سرفصل حسابداری بستانکاران تجاری/تامین‌کنندگان (3001) برای صدور سند خرید یافت نشد.');
      }
      // v8.0.17 (TD-268): کالای رایگان (اهدایی تأمین‌کننده) به WAC، بستانکار «درآمد کالای اهدایی»
      if (freeGoodsAmountNum.isPositive()) {
        const donatedGoodsAcc = await AccountMappingService.getDonatedGoodsIncomeAccount(tx);
        if (donatedGoodsAcc) {
          voucherItems.push({
            accountId: donatedGoodsAcc.id,
            detailedType: 'supplier',
            detailedId: matchedSupplierId || undefined,
            detailedName: doc.buyerName || 'تامین‌کننده',
            debit: 0,
            credit: freeGoodsAmountNum,
            currency: doc.currency || 'IRR',
            exchangeRate: freeGoodsRate,
            description: `کالای اهدایی (بدون بها) به بهای میانگین موزون بابت رسید/فاکتور خرید شماره ${doc.refNumber}`
          });
        } else if (isStrict) {
          throw new ValidationError('سرفصل حسابداری «درآمد کالای اهدایی» (5204) برای ثبت کالای رایگان رسید خرید یافت نشد.');
        }
      }
    }

    if (isProductionDoc && !wipAcc && isStrict) {
      throw new ValidationError('سرفصل حسابداری کالای در جریان ساخت (1402) برای صدور سند رسید تولید یافت نشد.');
    }

    if (voucherItems.length === 0) {
      if (isStrict) {
        throw new ValidationError(`سرفصل‌های حسابداری متناظر برای اقلام سند شماره «${doc.refNumber}» یافت نشد — لطفاً سرفصل‌های مواد و کالا را در کدینگ بررسی نمایید.`);
      }
      return null;
    }

    const voucherType: JournalVoucher['voucherType'] = isProductionDoc ? 'general' : 'purchase';
    const voucherDesc = isProductionDoc 
      ? `ثبت رسید تولید و تحویل محصول نهایی شماره ${doc.refNumber}${matchedProjectName ? ` - پروژه: ${matchedProjectName}` : ''}`
      : `ثبت فاکتور خرید / رسید ورود شماره ${doc.refNumber} - تامین‌کننده: ${doc.buyerName || 'تامین‌کننده'}`;

    // v7.0.31 (TD-193 / P1-8): یافتن سند حسابداری فاکتور فقط از پیوند صریح source_document_id؛
    // reference_id در اسناد معکوس/اصلاحی شناسه سند حسابداری مبدأ است و با شناسه اسناد انبار تداخل دارد.
    const [existingVoucher] = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.sourceDocumentId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));

    let resultVoucher: JournalVoucher | null = null;
    if (existingVoucher) {
      // P1-02 (H-01): اسناد تاییدشده و قطعی خرید هرگز نباید با سنک مجدد بازنویسی شوند
      if (existingVoucher.status === 'permanent' || existingVoucher.status === 'approved') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      resultVoucher = await VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType,
        description: voucherDesc,
        items: voucherItems,
      }, tx);
    } else {
      resultVoucher = await VoucherService.createJournalVoucher({
        date: docDate,
        voucherType,
        status: 'draft',
        description: voucherDesc,
        referenceModule: 'invoice',
        referenceId: docId,
        referenceNumber: doc.refNumber,
        sourceDocumentId: docId,
        currency: doc.currency || 'IRR',
        userId: options?.userId,
        username: options?.username,
        items: voucherItems
      }, tx);
    }

    if (!resultVoucher && isStrict) {
      throw new ValidationError(`صدور سند خودکار حسابداری برای سند خرید/رسید شماره «${doc.refNumber}» ناموفق بود.`);
    }

    return resultVoucher;
  }

  /**
   * Auto-generate/sync double-entry voucher for warehouse documents (حواله خروج مصرف/تولید، ضایعات و مرجوعی)
   */
  static async syncWarehouseDocumentVoucher(docId: number, options?: {
    userId?: number;
    username?: string;
    strict?: boolean;
    exchangeRate?: number;
  }, tx?: DbExecutor): Promise<JournalVoucher | null> {
    // P2-04: پیش‌فرض قرار دادن حالت Strict برای صدور سند انبار
    const isStrict = options?.strict !== false;
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, docId));
    if (!doc || doc.isDeleted === 1 || doc.status !== 'final') {
      if (isStrict) {
        throw new ValidationError(`سند انبار با شناسه ${docId} نامعتبر، حذف‌شده، یا نهایی‌نشده است.`);
      }
      return null;
    }

    const itemsList = await executor.select({
      id: documentItems.id,
      itemId: documentItems.itemId,
      quantity: documentItems.quantity,
      unitPrice: documentItems.unitPrice,
      discount: documentItems.discount,
      location: documentItems.location,
      name: items.name,
      code: items.code,
      unit: items.unit,
      itemType: items.type,
      category: items.category,
      weightedAverageCost: items.weightedAverageCost,
    })
    .from(documentItems)
    .leftJoin(items, eq(documentItems.itemId, items.id))
    .where(and(eq(documentItems.documentId, docId), eq(documentItems.isDeleted, 0)));

    if (!itemsList || itemsList.length === 0) {
      if (isStrict) {
        throw new ValidationError(`سند انبار شماره «${doc.refNumber}» فاقد هرگونه قلم کالا برای صدور سند حسابداری است.`);
      }
      return null;
    }

    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    // v9.0.199 (TD-550، B03-08): پشتیبان فقط کد معین پیش‌فرض است، هرگز حساب کل یا گروه (۱۴، ۵۱، ۶۰، ۷۰ و …)
    const rawMaterialAcc = (await AccountMappingService.getInventoryRawMaterialsAccount(tx)) || allAccs.find(a => a.code === '1401');
    const finishedGoodsAcc = (await AccountMappingService.getInventoryFinishedGoodsAccount(tx)) || allAccs.find(a => a.code === '1403');
    // V5.0.17 (TD-121): سرفصل کالای در جریان ساخت (۱۴۰۲) — حذف قطعی فالبک اشتباه ۶۰۰۱ (بهای تمام‌شده کالای فروش‌رفته)
    const wipAcc = (await AccountMappingService.getWorkInProgressAccount(tx)) || allAccs.find(a => a.code === '1402');
    // v8.0.114 (TD-413، TD-400): هزینه ضایعات از نگاشت حساب‌ها («ضایعات و افت کیفی» ۶۰۰۴)، نه کد ثابت ۶۰۰۳ (سربار)
    const wasteExpenseAcc = (await AccountMappingService.getWasteExpenseAccount(tx)) || allAccs.find(a => a.code === '6003') || allAccs.find(a => a.code === '7009');
    const salesReturnAcc = allAccs.find(a => a.code === '5101');
    // v8.0.14 (TD-259): بدهکاران تجاری برگشت از فروش از نگاشت حساب‌ها، همان حساب سند فروش
    const customerAcc = (await AccountMappingService.getTradeReceivablesAccount(tx)) || allAccs.find(a => a.code === '1201');
    // V6.0.10 (TD-145): سرفصل بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱) جهت صدور آرتیکل مرجوعی فروش
    const cogsAcc = (await AccountMappingService.getCostOfGoodsSoldAccount(tx)) || allAccs.find(a => a.code === '6001');

    // V10-1.1 & V5.0.17: fallback تاریخ ۱۰ کاراکتری ایمن
    const docDate = doc.date ? String(doc.date).slice(0, 10) : await businessTodayIsoDate();

    // V5.0.17 (TD-121): ارجحیت ستون دیتابیسی documents.projectId به جای رجکس متنی notes
    let matchedProjectId: number | null = doc.projectId ? Number(doc.projectId) : null;
    let matchedProjectName: string = '';
    if (matchedProjectId) {
      const [p] = await executor.select().from(productionProjects).where(and(eq(productionProjects.id, matchedProjectId), eq(productionProjects.isDeleted, 0)));
      if (p) {
        matchedProjectName = p.title || p.projectCode;
      }
    } else if (doc.notes) {
      const matchProj = String(doc.notes).match(/پروژه\s*[:#]?\s*([A-Za-z0-9-_]+)/i);
      if (matchProj && matchProj[1]) {
        const [p] = await executor.select().from(productionProjects).where(and(eq(productionProjects.projectCode, matchProj[1].trim()), eq(productionProjects.isDeleted, 0)));
        if (p) {
          matchedProjectId = p.id;
          matchedProjectName = p.title || p.projectCode;
        }
      }
    }

    let voucherType: JournalVoucher['voucherType'] = 'general';
    let voucherDescription = '';
    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'supplier' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency?: string;
      exchangeRate?: DecimalValue;
      description?: string;
    }[] = [];

    if (doc.type === 'remittance') {
      // v8.0.115 (TD-400): بهای حواله همان بهای ردیف‌های خروج کاردکس همین سند است (بی کاردکس: WAC جاری، هرگز قیمت سند)؛
      // پیش‌تر WAC لحظه صدور خوانده می‌شد و همگام‌سازی دوباره پیش‌نویس پس از رسید تازه عدد سند را عوض می‌کرد
      const outCost = await documentOutflowCost(executor, docId, itemsList);
      const rawMatCostNum = outCost.raw.round(4);
      const productCostNum = outCost.finished.round(4);
      const totalCost = fin(rawMatCostNum).add(productCostNum).round(4);
      if (!totalCost.isPositive()) return null;
      if (!wipAcc) {
        if (isStrict) {
          throw new ValidationError('سرفصل حسابداری کالای در جریان ساخت (۱۴۰۲) در تنظیمات حسابداری یافت نشد.');
        }
        return null;
      }

      voucherType = 'general';
      voucherDescription = `حواله خروج از انبار شماره ${doc.refNumber} - بابت مصرف/تولید${matchedProjectName ? ` (پروژه: ${matchedProjectName})` : ''}`;

      voucherItems.push({
        accountId: wipAcc.id,
        detailedType: matchedProjectId ? 'project' : 'other',
        detailedId: matchedProjectId || undefined,
        detailedName: matchedProjectName || (doc.buyerName || 'مصرف خط تولید / پروژه'),
        debit: totalCost,
        credit: 0,
        currency: doc.currency || 'IRR',
        description: `بهای مواد و کالای خارج‌شده بابت حواله ${doc.refNumber}${matchedProjectName ? ` (پروژه: ${matchedProjectName})` : ''}`
      });

      if (rawMatCostNum.isPositive()) {
        if (!rawMaterialAcc) {
          if (isStrict) {
            throw new ValidationError('سرفصل حسابداری موجودی مواد اولیه و ملزومات (۱۴۰۱) در تنظیمات حسابداری یافت نشد.');
          }
        } else {
          voucherItems.push({
            accountId: rawMaterialAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی مواد اولیه و ملزومات',
            debit: 0,
            credit: rawMatCostNum,
            currency: doc.currency || 'IRR',
            description: `کاهش موجودی مواد اولیه بابت حواله خروج شماره ${doc.refNumber}`
          });
        }
      }

      if (productCostNum.isPositive()) {
        if (!finishedGoodsAcc) {
          if (isStrict) {
            throw new ValidationError('سرفصل حسابداری موجودی کالای ساخته‌شده (۱۴۰۳) در تنظیمات حسابداری یافت نشد.');
          }
        } else {
          voucherItems.push({
            accountId: finishedGoodsAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی محصولات نهایی و کالای ساخته‌شده',
            debit: 0,
            credit: productCostNum,
            currency: doc.currency || 'IRR',
            description: `کاهش موجودی محصولات بابت حواله خروج شماره ${doc.refNumber}`
          });
        }
      }

    } else if (doc.type === 'waste') {
      // v8.0.115 (TD-400): بهای ضایعات همان بهای ردیف‌های خروج کاردکس همین سند است (مانند حواله)
      const wasteCost = await documentOutflowCost(executor, docId, itemsList);
      const rawMatWasteNum = wasteCost.raw.round(4);
      const productWasteNum = wasteCost.finished.round(4);
      const totalWasteAmount = fin(rawMatWasteNum).add(productWasteNum).round(4);
      if (!totalWasteAmount.isPositive()) return null;
      if (!wasteExpenseAcc) {
        if (isStrict) {
          throw new ValidationError('سرفصل حسابداری ضایعات و افت کیفی (۶۰۰۴) در تنظیمات حسابداری یافت نشد.');
        }
        return null;
      }

      voucherType = 'general';
      voucherDescription = `ثبت ضایعات و افت کیفی مواد/کالا شماره ${doc.refNumber}`;

      voucherItems.push({
        accountId: wasteExpenseAcc.id,
        detailedType: 'other',
        detailedName: 'هزینه ضایعات و افت کیفی',
        debit: totalWasteAmount,
        credit: 0,
        currency: doc.currency || 'IRR',
        description: `هزینه ضایعات و افت کیفی بابت سند شماره ${doc.refNumber}`
      });

      if (rawMatWasteNum.isPositive()) {
        if (!rawMaterialAcc) {
          if (isStrict) {
            throw new ValidationError('سرفصل حسابداری موجودی مواد اولیه و ملزومات (۱۴۰۱) جهت ثبت ضایعات یافت نشد.');
          }
        } else {
          voucherItems.push({
            accountId: rawMaterialAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی مواد اولیه و ملزومات',
            debit: 0,
            credit: rawMatWasteNum,
            currency: doc.currency || 'IRR',
            description: `کاهش موجودی مواد اولیه بابت ضایعات سند شماره ${doc.refNumber}`
          });
        }
      }

      if (productWasteNum.isPositive()) {
        if (!finishedGoodsAcc) {
          if (isStrict) {
            throw new ValidationError('سرفصل حسابداری موجودی کالای ساخته‌شده (۱۴۰۳) جهت ثبت ضایعات یافت نشد.');
          }
        } else {
          voucherItems.push({
            accountId: finishedGoodsAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی محصولات نهایی و کالای ساخته‌شده',
            debit: 0,
            credit: productWasteNum,
            currency: doc.currency || 'IRR',
            description: `کاهش موجودی محصولات بابت ضایعات سند شماره ${doc.refNumber}`
          });
        }
      }

    } else if (doc.type === 'return') {
      // V9-1.3: جمع مبالغ با FinancialDecimal
      let totalReturnAmount = fin(0);
      let fgReturnCost = fin(0);
      let rmReturnCost = fin(0);
      // v7.0.81 (TD-230): بهای تمام‌شده برگشتی همان بهایی است که کالا با آن وارد انبار شد (ردیف‌های کاردکس همین سند)،
      // تا ارزش کاردکس و برگشت بهای تمام‌شده یکی باشند؛ پیش‌تر WAC لحظه صدور سند (پس از ورود) خوانده می‌شد
      const kardexReturnCosts = await salesReturnKardexUnitCosts(executor, doc.id);

      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        totalReturnAmount = totalReturnAmount.add(fin(q).multiply(line.unitPrice).subtract(line.discount));

        // TD-145: بهای تمام‌شده کالای برگشتی (بدون ردیف کاردکس: WAC)
        const wac = kardexReturnCosts.get(line.itemId) ?? fin(line.weightedAverageCost);
        const lineCost = fin(q).multiply(wac);
        if (line.itemType === 'product') {
          fgReturnCost = fgReturnCost.add(lineCost);
        } else {
          rmReturnCost = rmReturnCost.add(lineCost);
        }
      }

      // TD-143, TD-145 & C-04: تسعیر ارزی بهای تمام‌شده مرجوعی در صورت ارزی بودن سند
      // v8.0.18 (TD-261): بهای ریالی کاردکس با نرخ همان ردیف (foreignCostRow)، تا معادل ریالی ردیف دقیقاً همان بهای کاردکس باشد
      const docExchangeRate = await VoucherSyncService.resolveVoucherExchangeRate(executor, doc, options?.exchangeRate);
      // v10.0.12 (TD-1030): balanced in rials as well as in the document currency, like the sales voucher
      const { parts: [fgReturnRow, rmReturnRow], total: returnCogsRow } = balancedCostRows([fgReturnCost, rmReturnCost], docExchangeRate);

      const totalReturnAmountNum = totalReturnAmount.round(4);
      const fgCostNum = fgReturnRow.amount;
      const rmCostNum = rmReturnRow.amount;
      const totalCogsNum = returnCogsRow.amount;
      const returnCogsRate = returnCogsRow.exchangeRate;

      if (!salesReturnAcc || !customerAcc) {
        if (isStrict) {
          throw new ValidationError('سرفصل‌های حسابداری برگشت از فروش (۵۱۰۱) یا حساب‌های دریافتنی تجاری (۱۲۰۱) در تنظیمات حسابداری یافت نشد.');
        }
        return null;
      }
      // v9.0.274 (TD-774، تصمیم ت۵ الف): مالیات برگشت (documents.vat_amount، به نسبت از فاکتور مرجع) مالیات پرداختنی را
      // بدهکار و مشتری را خالص به‌علاوه مالیات بستانکار می‌کند؛ پیش‌تر برگشت مالیات نداشت و هر دو مانده بیش از واقع می‌ماند
      const returnVatNum = fin(doc.vatAmount).round(4);
      const returnVatAcc = returnVatNum.isPositive() ? await AccountMappingService.getSalesVatPayableAccount(executor) : null;
      if (returnVatNum.isPositive() && !returnVatAcc) {
        if (isStrict) {
          throw new ValidationError('سرفصل حسابداری مالیات بر ارزش افزوده (۳۲۰۳) در تنظیمات حسابداری تعریف نشده است.');
        }
        logger.warn({ message: `VAT account not found for sales return ${doc.refNumber}, skipping auto voucher to prevent unbalanced entry` });
        return null;
      }
      const customerReturnCredit = totalReturnAmountNum.add(returnVatNum).round(4);

      // v9.0.336 (TD-778): مشتری برگشت از شناسه سند؛ سند پیشین بی شناسه با برابری دقیق نام
      const matchedCustomerId = await documentVoucherPartyId(executor, doc);

      voucherType = 'sales';
      voucherDescription = `سند برگشت از فروش / مرجوعی شماره ${doc.refNumber} - مشتری: ${doc.buyerName || 'مشتری'}`;

      if (totalReturnAmountNum.isPositive()) {
        // ۱) بدهکار: برگشت از فروش و تخفیفات (۵۱۰۱)
        voucherItems.push({
          accountId: salesReturnAcc.id,
          detailedType: 'other',
          detailedName: 'برگشت از فروش',
          debit: totalReturnAmountNum,
          credit: 0,
          currency: doc.currency || 'IRR',
          exchangeRate: docExchangeRate.isPositive() ? docExchangeRate : undefined,
          description: `برگشت از فروش بابت سند مرجوعی شماره ${doc.refNumber}`
        });
      }

      // ۱-ب) v9.0.274 (TD-774): بدهکار: مالیات و عوارض ارزش افزوده پرداختنی (۳۲۰۳)
      if (returnVatNum.isPositive() && returnVatAcc) {
        voucherItems.push({
          accountId: returnVatAcc.id,
          detailedType: 'other',
          detailedName: 'مالیات بر ارزش افزوده',
          debit: returnVatNum,
          credit: 0,
          currency: doc.currency || 'IRR',
          exchangeRate: docExchangeRate.isPositive() ? docExchangeRate : undefined,
          description: `برگشت مالیات و عوارض ارزش افزوده بابت سند مرجوعی شماره ${doc.refNumber}`
        });
      }

      if (customerReturnCredit.isPositive()) {
        // ۲) بستانکار: حساب‌های دریافتنی تجاری / مشتری (۱۲۰۱)، خالص به‌علاوه مالیات
        voucherItems.push({
          accountId: customerAcc.id,
          detailedType: 'customer',
          detailedId: matchedCustomerId || undefined,
          detailedName: doc.buyerName || 'مشتری',
          debit: 0,
          credit: customerReturnCredit,
          currency: doc.currency || 'IRR',
          exchangeRate: docExchangeRate.isPositive() ? docExchangeRate : undefined,
          description: `بستانکاری مشتری بابت مرجوعی کالا در سند شماره ${doc.refNumber}`
        });
      }

      // TD-145: ۳) زوج آرتیکل اصلاح موجودی کالا (بدهکار) و تعدیل بهای تمام‌شده کالای فروش‌رفته (بستانکار)
      if (totalCogsNum.isPositive()) {
        if (!cogsAcc) {
          if (isStrict) {
            throw new ValidationError('سرفصل بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱) برای صدور سند مرجوعی فروش در تنظیمات حسابداری یافت نشد.');
          }
        } else {
          // ۳-الف) بدهکار: افزایش موجودی کالای تولیدشده (۱۴۰۳)
          if (fgCostNum.isPositive() && finishedGoodsAcc) {
            voucherItems.push({
              accountId: finishedGoodsAcc.id,
              detailedType: 'other',
              detailedName: 'موجودی کالای ساخته‌شده',
              debit: fgCostNum,
              credit: 0,
              currency: doc.currency || 'IRR',
              exchangeRate: fgReturnRow.exchangeRate,
              description: `افزایش موجودی کالای ساخته‌شده بابت برگشت از فروش سند شماره ${doc.refNumber}`
            });
          }

          // ۳-ب) بدهکار: افزایش موجودی مواد اولیه (۱۴۰۱)
          if (rmCostNum.isPositive() && rawMaterialAcc) {
            voucherItems.push({
              accountId: rawMaterialAcc.id,
              detailedType: 'other',
              detailedName: 'موجودی مواد اولیه',
              debit: rmCostNum,
              credit: 0,
              currency: doc.currency || 'IRR',
              exchangeRate: rmReturnRow.exchangeRate,
              description: `افزایش موجودی مواد اولیه بابت برگشت از فروش سند شماره ${doc.refNumber}`
            });
          }

          // ۳-ج) بستانکار: تعدیل و کاهش بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱)
          voucherItems.push({
            accountId: cogsAcc.id,
            detailedType: 'other',
            detailedName: 'بهای تمام‌شده کالای فروش‌رفته',
            debit: 0,
            credit: totalCogsNum,
            currency: doc.currency || 'IRR',
            exchangeRate: returnCogsRate,
            description: `تعدیل بهای تمام‌شده کالای فروش‌رفته بابت مرجوعی فروش شماره ${doc.refNumber}`
          });
        }
      }
    } else {
      return null;
    }

    if (voucherItems.length === 0) {
      if (isStrict) {
        throw new ValidationError(`سرفصل‌های حسابداری متناظر برای اقلام حواله انبار شماره «${doc.refNumber}» یافت نشد.`);
      }
      return null;
    }

    // v7.0.31 (TD-193 / P1-8): یافتن سند حسابداری فاکتور فقط از پیوند صریح source_document_id؛
    // reference_id در اسناد معکوس/اصلاحی شناسه سند حسابداری مبدأ است و با شناسه اسناد انبار تداخل دارد.
    const [existingVoucher] = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.sourceDocumentId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));

    let resultVoucher: JournalVoucher | null = null;
    if (existingVoucher) {
      // P1-02 (H-01): اسناد تاییدشده و قطعی حواله/مرجوعی هرگز نباید با سنک مجدد بازنویسی شوند
      if (existingVoucher.status === 'permanent' || existingVoucher.status === 'approved') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      resultVoucher = await VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType,
        description: voucherDescription,
        items: voucherItems,
      }, tx);
    } else {
      resultVoucher = await VoucherService.createJournalVoucher({
        date: docDate,
        voucherType,
        status: 'draft',
        description: voucherDescription,
        referenceModule: 'invoice',
        referenceId: docId,
        referenceNumber: doc.refNumber,
        sourceDocumentId: docId,
        currency: doc.currency || 'IRR',
        userId: options?.userId,
        username: options?.username,
        items: voucherItems
      }, tx);
    }

    if (!resultVoucher && isStrict) {
      throw new ValidationError(`صدور سند خودکار حسابداری برای حواله انبار شماره «${doc.refNumber}» ناموفق بود.`);
    }

    return resultVoucher;
  }

  /**
   * Auto-generate double-entry voucher when a document is finalized
   */
  static async autoCreateVoucherForInvoice(
    documentId: number,
    userId?: number,
    username?: string,
    tx?: DbExecutor,
    options?: { strict?: boolean }
  ): Promise<JournalVoucher | null> {
    const isStrict = Boolean(options?.strict);
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, documentId));
    if (!doc || doc.isDeleted === 1 || doc.status !== 'final') {
      if (isStrict) {
        throw new ValidationError(`سند با شناسه ${documentId} نامعتبر، حذف‌شده، یا نهایی‌نشده است.`);
      }
      return null;
    }

    const existing = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.sourceDocumentId, documentId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (existing.length > 0) return VoucherService.getJournalVoucherById(existing[0].id, tx);

    if (doc.type === 'invoice') {
      return this.syncSalesInvoiceVoucher(documentId, { userId, username, strict: isStrict }, tx);
    } else if (doc.type === 'receipt' || doc.type === 'production_receipt' || doc.type === 'purchase') {
      return this.syncPurchaseInvoiceVoucher(documentId, { userId, username, strict: isStrict }, tx);
    } else if (['remittance', 'waste', 'return'].includes(doc.type)) {
      return this.syncWarehouseDocumentVoucher(documentId, { userId, username, strict: isStrict }, tx);
    }

    return null;
  }

  /**
   * Auto-generate double-entry voucher when piecework payroll is approved/paid
   * V4.0.5 (F-3 / TD-093): پشتیبانی از strict mode جهت جلوگیری از بلعیده‌شدن خطاهای صدور سند
   */
  static async autoCreateVoucherForPayroll(
    payrollId: number,
    userId?: number,
    username?: string,
    tx?: DbExecutor,
    options?: { strict?: boolean }
  ): Promise<JournalVoucher | null> {
    const executor = tx || orm;
    const isStrict = Boolean(options?.strict);
    const [pay] = await executor.select().from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollId));
    if (!pay || pay.isDeleted === 1) {
      if (isStrict) {
        throw new NotFoundError(`فیش حقوقی با شناسه ${payrollId} یافت نشد یا حذف شده است.`);
      }
      return null;
    }

    // TD-242: سند فیش فقط از پیوند صریح source_payroll_id (یا سند قدیمی بدون پیوند با الگوی دقیق همین متد)؛
    // سند معکوس/اصلاحی که reference_id آن شناسه «سند حسابداری مبدأ» است دیگر سند این فیش تلقی نمی‌شود.
    const candidates = await executor.select().from(journalVouchers)
      .where(payrollVouchersWhere(payrollId, pay.payrollNumber));
    const existing = pickPayrollVoucher(candidates, payrollId, pay.payrollNumber);
    if (existing) return VoucherService.getJournalVoucherById(existing.id, tx);

    const [pers] = await executor.select().from(personnel).where(eq(personnel.id, pay.personnelId));

    // V1.9.0: تفکیک اجزای فیش در سند صدور —
    //   DR «هزینه حقوق ثابت» (سهم حقوق ثابت + پاداش) و DR «دستمزد مستقیم تولید» (سهم پرکیسی/تولیدی)
    //   / CR «حقوق و دستمزد پرداختنی» (ناخالص) — کسر مساعده و سایر کسورات در سند تسویه اعمال می‌شوند.
    const wageExpenseAcc = await AccountMappingService.getDirectProductionWagesAccount(tx);
    const payableAcc = await AccountMappingService.getWagesPayableAccount(tx);
    const fixedSalaryExpenseAcc = await AccountMappingService.getFixedSalaryExpenseAccount(tx);

    if (!wageExpenseAcc || !payableAcc || !fixedSalaryExpenseAcc) {
      const missingAccounts = [
        !wageExpenseAcc && 'دستمزد مستقیم تولید (6002)',
        !payableAcc && 'حقوق و دستمزد پرداختنی (3201)',
        !fixedSalaryExpenseAcc && 'هزینه حقوق و دستمزد ثابت (6003)'
      ].filter(Boolean).join('، ');

      logger.warn({ message: `Conceptual payroll accounts not found for payroll auto voucher: ${missingAccounts}` });
      if (isStrict) {
        throw new ValidationError(`سرفصل‌های معین حسابداری برای صدور سند حقوق یافت نشد (${missingAccounts}) — لطفاً از تنظیمات ← تنظیمات حسابداری پیکربندی کنید.`);
      }
      return null;
    }

    // v8.0.117 (TD-402): مبالغ فیش با FinancialDecimal (§1.8)، نه عدد جاوااسکریپت؛ پیش‌تر مبلغ بزرگ با رقم اعشار با
    // Number() گرد می‌شد و سند حسابداری با مبلغ فیش یکی نبود
    const nonNegative = (v: DecimalValue) => { const d = fin(v); return d.isPositive() ? d : fin(0); };
    const pieceworkAmount = fin(pay.totalPieceworkAmount);
    const bonuses = fin(pay.totalBonuses);
    const fixedAmount = fin(pay.totalFixedAmount);
    const grossAmount = pieceworkAmount.add(bonuses).add(fixedAmount);
    const netPayable = fin(pay.netPayable);
    // v9.0.266 (TD-804، تصمیم ت۱ الف): سندی که با خالص فیش نمی‌خواند ساخته نمی‌شود و فیش با خالص مثبت بی‌صدا بی سند نمی‌ماند.
    // پیش‌تر کسورات منفی صفر گرفته می‌شد (بستانکار ۳۲۰۱ کمتر از خالص) و با ناخالص صفر `null` برمی‌گشت، حتی در حالت strict.
    const refuse = (message: string, code: string): null => {
      logger.warn({ message: `Payroll voucher refused for ${pay.payrollNumber}: ${code}` });
      if (isStrict) throw new ValidationError(message, undefined, code);
      return null;
    };
    if (bonuses.isNegative() || fin(pay.totalDeductions).isNegative() || fin(pay.advanceDeduction).isNegative()) {
      return refuse(`فیش ${pay.payrollNumber} پاداش، کسورات یا کسر مساعده منفی دارد و سند آن با خالص فیش نمی‌خواند؛ این فیش را باطل و دوباره صادر کنید.`, 'PAYROLL_NEGATIVE_COMPONENT');
    }
    if (!grossAmount.isPositive()) {
      if (netPayable.isPositive()) {
        return refuse(`خالص فیش ${pay.payrollNumber} مثبت است ولی اجزای آن (کارکرد، حقوق ثابت و پاداش) صفر است؛ سند حسابداری برای آن ساخته نمی‌شود.`, 'PAYROLL_VOUCHER_NET_MISMATCH');
      }
      return null;
    }

    const items: Array<{
      accountId: number;
      detailedType: 'personnel';
      detailedId: number;
      detailedName: string;
      debit: DecimalValue;
      credit: DecimalValue;
      currency: string;
      description: string;
    }> = [];
    // سهم دستمزد مستقیم تولید (کارکرد پرکیسی)
    if (pieceworkAmount.isPositive()) {
      items.push({
        accountId: wageExpenseAcc.id,
        detailedType: 'personnel',
        detailedId: pay.personnelId,
        detailedName: pers?.fullName || 'پرسنل',
        debit: pieceworkAmount,
        credit: 0,
        currency: 'IRR',
        description: `هزینه دستمزد تولیدی کارمزدی فیش ${pay.payrollNumber}`
      });
    }
    // سهم هزینه حقوق ثابت (+ پاداش/اضافه‌کار)
    const fixedBucket = fixedAmount.add(bonuses);
    if (fixedBucket.isPositive()) {
      items.push({
        accountId: fixedSalaryExpenseAcc.id,
        detailedType: 'personnel',
        detailedId: pay.personnelId,
        detailedName: pers?.fullName || 'پرسنل',
        debit: fixedBucket,
        credit: 0,
        currency: 'IRR',
        description: `هزینه حقوق و دستمزد ثابت فیش ${pay.payrollNumber}${bonuses.isPositive() ? ' (شامل پاداش/اضافه‌کار)' : ''}`
      });
    }

    // V4.0.33: تفکیک دقیق طرف بستانکار بر مبنای استاندارد حسابداری دوطرفه:
    // ۱. کسر از مساعده پرسنلی (بستانکار حساب 1301 مساعده)
    // ۲. کسورات حقوق پرداختنی (بستانکار حساب نگاشت‌شده، پیش‌فرض 3205؛ تا v9.0.274 پیش‌دریافت مشتری 3202، TD-554)
    // ۳. خالص حقوق پرداختنی (بستانکار حساب 3201 حقوق پرداختنی)
    const advanceDeduction = nonNegative(pay.advanceDeduction);
    const otherDeductions = nonNegative(pay.totalDeductions);
    let allocatedCredits = fin(0);

    if (advanceDeduction.isPositive()) {
      const advanceAcc = await AccountMappingService.getEmployeeAdvanceAccount(tx);
      if (advanceAcc) {
        items.push({
          accountId: advanceAcc.id,
          detailedType: 'personnel',
          detailedId: pay.personnelId,
          detailedName: pers?.fullName || 'پرسنل',
          debit: 0,
          credit: advanceDeduction,
          currency: 'IRR',
          description: `کسر مساعده/وام پرسنلی ${pers?.fullName || ''} در فیش ${pay.payrollNumber}`
        });
        allocatedCredits = allocatedCredits.add(advanceDeduction);
      } else if (isStrict) {
        throw new ValidationError(`حساب معین مساعده پرسنلی (1301) جهت کسر مساعده فیش ${pay.payrollNumber} یافت نشد.`);
      }
    }

    if (otherDeductions.isPositive()) {
      const deductionsAcc = await AccountMappingService.getEmployeeDeductionsPayableAccount(tx);
      if (deductionsAcc) {
        items.push({
          accountId: deductionsAcc.id,
          detailedType: 'personnel',
          detailedId: pay.personnelId,
          detailedName: pers?.fullName || 'پرسنل',
          debit: 0,
          credit: otherDeductions,
          currency: 'IRR',
          // v9.0.329 (TD-861): شرح کسورات فیش در ردیف کسورات حقوق پرداختنی می‌آید (فیش پیش از آن شرح ندارد)
          description: `سایر کسورات فیش ${pay.payrollNumber} (${pers?.fullName || 'پرسنل'})${pay.deductionsDescription ? `: ${pay.deductionsDescription}` : ''}`
        });
        allocatedCredits = allocatedCredits.add(otherDeductions);
      } else if (isStrict) {
        throw new ValidationError(`حساب «کسورات حقوق پرداختنی» (نگاشت حساب‌ها، پیش‌فرض ۳۲۰۵) برای ثبت کسورات فیش ${pay.payrollNumber} یافت نشد.`);
      }
    }

    // بستانکاری خالص حقوق پرداختنی به پرسنل (تضمین موازنه ۱۰۰٪ بدهکار و بستانکار)
    const payableCredit = nonNegative(grossAmount.subtract(allocatedCredits));
    // v9.0.266 (TD-804): ناوردایی I10 — بستانکار ۳۲۰۱ سند همان خالص فیش است
    if (payableCredit.subtract(netPayable).abs().greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
      return refuse(`بستانکار «حقوق و دستمزد پرداختنی» سند (${payableCredit.toNumber().toLocaleString('fa-IR')}) با خالص فیش ${pay.payrollNumber} (${netPayable.toNumber().toLocaleString('fa-IR')}) نمی‌خواند؛ سند صادر نشد.`, 'PAYROLL_VOUCHER_NET_MISMATCH');
    }
    if (payableCredit.isPositive()) {
      items.push({
        accountId: payableAcc.id,
        detailedType: 'personnel',
        detailedId: pay.personnelId,
        detailedName: pers?.fullName || 'پرسنل',
        debit: 0,
        credit: payableCredit,
        currency: 'IRR',
        description: `خالص حقوق و دستمزد پرداختنی به ${pers?.fullName || ''} بابت دوره ${isoToJalaliDate(pay.startDate) || pay.startDate} تا ${isoToJalaliDate(pay.endDate) || pay.endDate}`
      });
    }

    const createdVoucher = await VoucherService.createJournalVoucher({
      // V3.0.7 (TD-062): فال‌بک تاریخ از ساعت توافقی کسب‌وکار (نه UTC خام)
      date: pay.endDate || await businessTodayIsoDate(),
      voucherType: 'payroll',
      status: 'draft',
      description: `ثبت هزینه و محاسبه حقوق و کارمزد ${pay.title} - پرسنل: ${pers?.fullName || 'پرسنل'} (${pay.payrollNumber})`,
      referenceModule: 'payroll',
      referenceId: pay.id,
      referenceNumber: pay.payrollNumber,
      sourcePayrollId: pay.id,
      currency: 'IRR',
      userId,
      username,
      items
    }, tx);

    if (!createdVoucher && isStrict) {
      throw new ValidationError(`ثبت سند حسابداری برای فیش ${pay.payrollNumber} ناموفق بود.`);
    }

    return createdVoucher;
  }

  /**
   * v7.0.31 (TD-193 / audit P1-8): جایگزین syncAllInvoiceVouchers که در هر بوت هر Pod روی کل تاریخ اسناد
   * قطعی حلقه می‌زد و اسناد پیش‌نویس موجود را بی‌صدا بازنویسی می‌کرد. اکنون (با تصمیم مالک محصول) فقط به‌صورت
   * دستی اجرا می‌شود، فقط برای اسناد قطعی فاقد سند حسابداری سند می‌سازد و هیچ سند موجودی را تغییر نمی‌دهد؛
   * دسته‌ای، هر سند در تراکنش جدا تحت قفل سطری سند، و با قفل مشورتی تا در کل خوشه فقط یک اجرا فعال باشد.
   */
  static async syncMissingDocumentVouchers(options?: {
    batchSize?: number;
    userId?: number;
    username?: string;
  }): Promise<MissingDocumentVoucherSyncSummary> {
    const batchSize = Math.min(1000, Math.max(1, Math.floor(Number(options?.batchSize) || 200)));
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.DOCUMENT_VOUCHER_SYNC, async () => {
      const summary: MissingDocumentVoucherSyncSummary = {
        locked: false, checked: 0, created: 0, failed: 0, skippedForReview: 0, errors: [], reviewDocumentIds: [],
      };
      let lastId = 0;
      for (;;) {
        const batch = await orm.select({ id: documents.id })
          .from(documents)
          .leftJoin(journalVouchers, and(
            eq(journalVouchers.sourceDocumentId, documents.id),
            eq(journalVouchers.isDeleted, 0)
          ))
          .where(and(
            inArray(documents.type, [...AUTO_VOUCHER_DOC_TYPES]),
            eq(documents.status, 'final'),
            eq(documents.isDeleted, 0),
            isNull(journalVouchers.id),
            gt(documents.id, lastId)
          ))
          .orderBy(asc(documents.id))
          .limit(batchSize);
        if (batch.length === 0) break;

        for (const row of batch) {
          lastId = row.id;
          summary.checked++;
          try {
            const result = await orm.transaction(async (tx) => {
              // قفل سطری سند: با نهایی‌سازی/حذف همزمان همین سند سریال می‌شود
              const [doc] = await tx.select({ id: documents.id, status: documents.status, isDeleted: documents.isDeleted, refNumber: documents.refNumber })
                .from(documents).where(eq(documents.id, row.id)).for('update');
              if (!doc || doc.isDeleted === 1 || doc.status !== 'final') return 'skipped' as const;

              const [linked] = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
                .where(and(eq(journalVouchers.sourceDocumentId, row.id), eq(journalVouchers.isDeleted, 0)));
              if (linked) return 'skipped' as const;

              // سند قدیمی بدون پیوند (مثلاً سند دستی با ماژول invoice): برای جلوگیری از ثبت دوباره، فقط گزارش
              const legacy = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
                .where(and(
                  eq(journalVouchers.referenceModule, 'invoice'),
                  eq(journalVouchers.referenceId, row.id),
                  eq(journalVouchers.isDeleted, 0),
                  isNull(journalVouchers.sourceDocumentId),
                  ...DERIVED_VOUCHER_REF_PREFIXES.map(prefix => notLike(journalVouchers.referenceNumber, `${prefix}%`))
                ))
                .limit(1);
              if (legacy.length > 0) return 'review' as const;

              const voucher = await this.autoCreateVoucherForInvoice(row.id, options?.userId, options?.username, tx, { strict: true });
              return voucher ? 'created' as const : 'skipped' as const;
            });
            if (result === 'created') summary.created++;
            if (result === 'review') {
              summary.skippedForReview++;
              if (summary.reviewDocumentIds.length < 200) summary.reviewDocumentIds.push(row.id);
            }
          } catch (docErr) {
            summary.failed++;
            const message = docErr instanceof Error ? docErr.message : String(docErr);
            if (summary.errors.length < 50) summary.errors.push({ documentId: row.id, message });
            logger.warn({ message: `[VoucherSync] Could not issue voucher for document ${row.id}`, error: message });
          }
        }
        if (batch.length < batchSize) break;
      }
      return summary;
    });

    if (!outcome.acquired) {
      return { locked: true, checked: 0, created: 0, failed: 0, skippedForReview: 0, errors: [], reviewDocumentIds: [] };
    }
    logger.info({ message: `[VoucherSync] Missing document vouchers: checked=${outcome.result.checked} created=${outcome.result.created} failed=${outcome.result.failed} review=${outcome.result.skippedForReview}` });
    return outcome.result;
  }
}
