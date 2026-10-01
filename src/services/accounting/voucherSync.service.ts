import { orm, type DbExecutor } from '../../db/drizzle.js';
import { 
  documents, 
  documentItems, 
  journalVouchers, 
  customers, 
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
import { AccountMappingService } from './accountMapping.service.js';
import { logger } from '../../middleware/logger.js';
import { fin } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ValidationError, NotFoundError } from '../../errors/customErrors.js';
import type { JournalVoucher } from '../../types.js';

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

    for (const it of itemsList) {
      const q = Number(it.quantity) || 0;
      const p = Number(it.unitPrice) || 0;
      const d = Number(it.discount) || 0;
      grossAmount = grossAmount.add(fin(q).multiply(p));
      totalDiscount = totalDiscount.add(d);
    }

    const grossAmountNum = grossAmount.round(4).toNumber();
    const totalDiscountNum = totalDiscount.round(4).toNumber();

    if (grossAmountNum <= 0) return null;

    const netAmountRaw = fin(grossAmountNum).subtract(totalDiscountNum);
    const netAmount = netAmountRaw.isNegative() ? 0 : netAmountRaw.round(4).toNumber();

    // v7.0.32 (TD-197 / audit P1-7): مبلغ مالیات فقط از ستون ساختاریافته خود فاکتور خوانده می‌شود. پیش‌تر از
    // متن آزاد یادداشت با Regex استخراج می‌شد و یادداشتی مانند «مالیات ۲ قلم آخر محاسبه نشود» مالیات ۲ ریالی
    // در دفاتر ثبت می‌کرد که در خود فاکتور وجود نداشت.
    const vatAmount = fin(Number(doc.vatAmount) || 0).round(4).toNumber();

    const finalPayable = fin(netAmount).add(vatAmount).round(4).toNumber();

    // Conceptual Account Resolution (Subphase 9.2 + V5.0.17 TD-120)
    const customerAcc = await AccountMappingService.getTradeReceivablesAccount(tx);
    const discountAcc = await AccountMappingService.getSalesDiscountAccount(tx);
    const revenueAcc = await AccountMappingService.getSalesRevenueAccount(tx);
    const vatAcc = await AccountMappingService.getSalesVatPayableAccount(tx);
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
    if (totalDiscountNum > 0 && !discountAcc) {
      if (isStrict) {
        throw new ValidationError('سرفصل حسابداری تخفیفات اعطایی (۵۱۰۲) در تنظیمات حسابداری تعریف نشده است.');
      }
      logger.warn({ message: `Discount account not found for invoice ${doc.refNumber}, skipping auto voucher to prevent unbalanced entry` });
      return null;
    }

    if (vatAmount > 0 && !vatAcc) {
      if (isStrict) {
        throw new ValidationError('سرفصل حسابداری مالیات بر ارزش افزوده (۳۲۰۳) در تنظیمات حسابداری تعریف نشده است.');
      }
      logger.warn({ message: `VAT account not found for invoice ${doc.refNumber}, skipping auto voucher to prevent unbalanced entry` });
      return null;
    }

    let matchedCustomerId: number | null = null;
    if (doc.buyerName) {
      const [matchedCust] = await executor.select().from(customers)
        .where(and(eq(customers.name, doc.buyerName.trim()), eq(customers.isDeleted, 0)));
      if (matchedCust) matchedCustomerId = matchedCust.id;
    }

    // V10-1.1 & V5.0.17: fallback تاریخ ۱۰ کاراکتری ایمن
    const docDate = doc.date ? String(doc.date).slice(0, 10) : await businessTodayIsoDate();

    // V6.0.4 (TD-143): استخراج نرخ تسعیر ارز در فاکتورهای ارزی
    const docCurrency = (doc.currency || 'IRR').toUpperCase();
    let exchangeRate = 1;
    if (docCurrency !== 'IRR') {
      if (options?.exchangeRate !== undefined && Number(options.exchangeRate) > 0) {
        exchangeRate = Number(options.exchangeRate);
      } else if (doc.notes) {
        const match = doc.notes.match(/(?:نرخ\s*تسعیر|exchange_?rate)\s*[:=]?\s*([\d,.]+)/i);
        if (match && match[1]) {
          const parsed = Number(match[1].replace(/,/g, ''));
          if (parsed > 0) exchangeRate = parsed;
        }
      }
      if (exchangeRate === 1) {
        try {
          const [settingRow] = await executor.select().from(appSettings)
            .where(eq(appSettings.key, `exchange_rate_${docCurrency.toLowerCase()}`));
          if (settingRow && settingRow.value) {
            const val = Number(settingRow.value);
            if (val > 0) exchangeRate = val;
          }
        } catch {
          // ignore
        }
      }
    }

    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: number;
      credit: number;
      currency?: string;
      exchangeRate?: number;
      description?: string;
    }[] = [];

    // ۱) بدهکار: حساب‌های دریافتنی تجاری (مشتری)
    voucherItems.push({
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
    if (totalDiscountNum > 0 && discountAcc) {
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
    voucherItems.push({
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
    if (vatAmount > 0 && vatAcc) {
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
    const txCostMap = new Map<number, number>();
    for (const t of docTxs) {
      if (t.unitPrice && Number(t.unitPrice) > 0) {
        txCostMap.set(t.itemId, Number(t.unitPrice));
      }
    }

    let fgCost = fin(0);
    let rmCost = fin(0);
    for (const line of itemsList) {
      const q = Number(line.quantity) || 0;
      const historicalCost = txCostMap.get(line.itemId);
      const wac = (historicalCost !== undefined && historicalCost > 0)
        ? historicalCost
        : (Number(line.weightedAverageCost) || 0); // fallback to current WAC if no tx recorded
      const lineCost = fin(q).multiply(wac);
      if (line.itemType === 'product') {
        fgCost = fgCost.add(lineCost);
      } else {
        rmCost = rmCost.add(lineCost);
      }
    }

    // Apply currency conversion (TD-143): Convert IRR WAC to invoice foreign currency
    let fgCostConv = fgCost;
    let rmCostConv = rmCost;
    if (docCurrency !== 'IRR' && exchangeRate > 0) {
      if (exchangeRate >= 1) {
        fgCostConv = fgCost.divide(exchangeRate);
        rmCostConv = rmCost.divide(exchangeRate);
      } else {
        fgCostConv = fgCost.multiply(exchangeRate);
        rmCostConv = rmCost.multiply(exchangeRate);
      }
    }

    const fgCostNum = fgCostConv.round(4).toNumber();
    const rmCostNum = rmCostConv.round(4).toNumber();
    const totalCogsNum = fin(fgCostNum).add(rmCostNum).round(4).toNumber();

    if (totalCogsNum > 0) {
      if (!cogsAcc || (fgCostNum > 0 && !fgAcc) || (rmCostNum > 0 && !rmAcc)) {
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
          exchangeRate: exchangeRate,
          description: `بهای تمام‌شده فاکتور فروش شماره ${doc.refNumber}${docCurrency !== 'IRR' ? ` (تسعیر با نرخ ${exchangeRate})` : ''}`
        });

        // ۵-ب) بستانکار: کاهش موجودی کالای تولیدشده (۱۴۰۳)
        if (fgCostNum > 0 && fgAcc) {
          voucherItems.push({
            accountId: fgAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی کالای ساخته‌شده',
            debit: 0,
            credit: fgCostNum,
            currency: doc.currency || 'IRR',
            exchangeRate: exchangeRate,
            description: `کاهش موجودی کالای ساخته‌شده بابت فاکتور فروش شماره ${doc.refNumber}`
          });
        }

        // ۵-ج) بستانکار: کاهش موجودی مواد اولیه (۱۴۰۱)
        if (rmCostNum > 0 && rmAcc) {
          voucherItems.push({
            accountId: rmAcc.id,
            detailedType: 'other',
            detailedName: 'موجودی مواد اولیه',
            debit: 0,
            credit: rmCostNum,
            currency: doc.currency || 'IRR',
            exchangeRate: exchangeRate,
            description: `کاهش موجودی مواد اولیه بابت فاکتور فروش شماره ${doc.refNumber}`
          });
        }
      }
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
      // P1-02 (H-01): اسناد تاییدشده و قطعی هرگز نباید با بهای تمام‌شده روز بازنویسی شوند
      if (existingVoucher.status === 'permanent' || existingVoucher.status === 'approved') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      resultVoucher = await VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType: 'sales',
        description: `ثبت فاکتور فروش شماره ${doc.refNumber} به نام ${doc.buyerName || 'مشتری'}${totalDiscountNum > 0 ? ' (همراه با تخفیف)' : ''}${vatAmount > 0 ? ' (شامل ارزش‌افزوده)' : ''}`,
        items: voucherItems,
      }, tx);
    } else {
      resultVoucher = await VoucherService.createJournalVoucher({
        date: docDate,
        voucherType: 'sales',
        status: 'draft',
        description: `ثبت فاکتور فروش شماره ${doc.refNumber} به نام ${doc.buyerName || 'مشتری'}${totalDiscountNum > 0 ? ' (همراه با تخفیف)' : ''}${vatAmount > 0 ? ' (شامل ارزش‌افزوده)' : ''}`,
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

    // V9-1.3: جمع مبالغ با FinancialDecimal
    let rawMaterialsAmount = fin(0);
    let finishedGoodsAmount = fin(0);

    for (const it of itemsList) {
      const q = Number(it.quantity) || 0;
      // P1-03 (M-06): در رسیدهای خرید قیمت واقعی فاکتور ثبت می‌شود؛ فال‌بک به WAC فقط مختص رسیدهای تولید است
      const p = doc.type === 'production_receipt'
        ? (Number(it.unitPrice) > 0 ? Number(it.unitPrice) : (Number(it.weightedAverageCost) || 0))
        : Number(it.unitPrice || 0);
      const d = Number(it.discount) || 0;
      const lineNetRaw = fin(q).multiply(p).subtract(d);
      const lineNet = lineNetRaw.isNegative() ? fin(0) : lineNetRaw;

      if (it.itemType === 'product') {
        finishedGoodsAmount = finishedGoodsAmount.add(lineNet);
      } else if (it.itemType === 'raw_material') {
        rawMaterialsAmount = rawMaterialsAmount.add(lineNet);
      } else {
        // Fallback based on doc type
        if (doc.type === 'production_receipt') {
          finishedGoodsAmount = finishedGoodsAmount.add(lineNet);
        } else {
          rawMaterialsAmount = rawMaterialsAmount.add(lineNet);
        }
      }
    }

    const rawMaterialsAmountNum = rawMaterialsAmount.round(4).toNumber();
    const finishedGoodsAmountNum = finishedGoodsAmount.round(4).toNumber();

    const totalGross = fin(rawMaterialsAmountNum).add(finishedGoodsAmountNum).round(4).toNumber();
    if (totalGross <= 0) return null;

    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    const rawMaterialAcc = allAccs.find(a => a.code === '1401') || allAccs.find(a => a.code === '14');
    const wipAcc = allAccs.find(a => a.code === '1402') || allAccs.find(a => a.code === '14');
    const finishedGoodsAcc = allAccs.find(a => a.code === '1403') || allAccs.find(a => a.code === '14');
    const supplierAcc = allAccs.find(a => a.code === '3001') || allAccs.find(a => a.code === '30');

    let matchedSupplierId: number | null = null;
    if (doc.buyerName && doc.type !== 'production_receipt') {
      const [matchedCust] = await executor.select().from(customers)
        .where(and(eq(customers.name, doc.buyerName.trim()), eq(customers.isDeleted, 0)));
      if (matchedCust) matchedSupplierId = matchedCust.id;
    }

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
    const isProduction = doc.type === 'production_receipt';

    // V6.0.4 (TD-143): استخراج نرخ تسعیر ارز در فاکتورهای خرید ارزی
    const docCurrency = (doc.currency || 'IRR').toUpperCase();
    let exchangeRate = 1;
    if (docCurrency !== 'IRR') {
      if (options?.exchangeRate !== undefined && Number(options.exchangeRate) > 0) {
        exchangeRate = Number(options.exchangeRate);
      } else if (doc.notes) {
        const match = doc.notes.match(/(?:نرخ\s*تسعیر|exchange_?rate)\s*[:=]?\s*([\d,.]+)/i);
        if (match && match[1]) {
          const parsed = Number(match[1].replace(/,/g, ''));
          if (parsed > 0) exchangeRate = parsed;
        }
      }
    }

    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'supplier' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: number;
      credit: number;
      currency?: string;
      exchangeRate?: number;
      description?: string;
    }[] = [];

    // Debit 1: Raw Materials
    if (rawMaterialsAmountNum > 0 && rawMaterialAcc) {
      voucherItems.push({
        accountId: rawMaterialAcc.id,
        detailedType: 'other',
        detailedName: 'موجودی مواد اولیه و ملزومات',
        debit: rawMaterialsAmountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        exchangeRate,
        description: `ورود مواد اولیه و ملزومات بابت ${isProduction ? 'رسید تولید' : 'رسید/فاکتور خرید'} شماره ${doc.refNumber}`
      });
    }

    // Debit 2: Finished Goods
    if (finishedGoodsAmountNum > 0 && finishedGoodsAcc) {
      voucherItems.push({
        accountId: finishedGoodsAcc.id,
        detailedType: 'other',
        detailedName: 'موجودی محصولات نهایی و کالای ساخته‌شده',
        debit: finishedGoodsAmountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        exchangeRate,
        description: `ورود محصولات ساخته‌شده بابت ${isProduction ? 'رسید تولید' : 'رسید ورود کالا'} شماره ${doc.refNumber}${matchedProjectName ? ` (پروژه: ${matchedProjectName})` : ''}`
      });
    }

    // Credit side
    if (isProduction) {
      if (wipAcc) {
        voucherItems.push({
          accountId: wipAcc.id,
          detailedType: matchedProjectId ? 'project' : 'other',
          detailedId: matchedProjectId || undefined,
          detailedName: matchedProjectName || (doc.buyerName || 'خط تولید / کالای در جریان ساخت'),
          debit: 0,
          credit: totalGross,
          currency: doc.currency || 'IRR',
          exchangeRate,
          description: `انتقال بهای تمام شده از کالای در جریان ساخت به انبار بابت رسید تولید شماره ${doc.refNumber}${matchedProjectName ? ` (پروژه: ${matchedProjectName})` : ''}`
        });
      }
    } else {
      if (supplierAcc) {
        voucherItems.push({
          accountId: supplierAcc.id,
          detailedType: 'supplier',
          detailedId: matchedSupplierId || undefined,
          detailedName: doc.buyerName || 'تامین‌کننده',
          debit: 0,
          credit: totalGross,
          currency: doc.currency || 'IRR',
          exchangeRate,
          description: `بستانکاری تامین‌کننده بابت فاکتور خرید / رسید ورود کالا و مواد شماره ${doc.refNumber}`
        });
      } else if (isStrict) {
        throw new ValidationError('سرفصل حسابداری بستانکاران تجاری/تامین‌کنندگان (3001) برای صدور سند خرید یافت نشد.');
      }
    }

    if (isProduction && !wipAcc && isStrict) {
      throw new ValidationError('سرفصل حسابداری کالای در جریان ساخت (1402) برای صدور سند رسید تولید یافت نشد.');
    }

    if (voucherItems.length === 0) {
      if (isStrict) {
        throw new ValidationError(`سرفصل‌های حسابداری متناظر برای اقلام سند شماره «${doc.refNumber}» یافت نشد — لطفاً سرفصل‌های مواد و کالا را در کدینگ بررسی نمایید.`);
      }
      return null;
    }

    const voucherType: JournalVoucher['voucherType'] = isProduction ? 'general' : 'purchase';
    const voucherDesc = isProduction 
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
    const rawMaterialAcc = (await AccountMappingService.getInventoryRawMaterialsAccount(tx)) || allAccs.find(a => a.code === '1401') || allAccs.find(a => a.code === '14');
    const finishedGoodsAcc = (await AccountMappingService.getInventoryFinishedGoodsAccount(tx)) || allAccs.find(a => a.code === '1403') || allAccs.find(a => a.code === '14');
    // V5.0.17 (TD-121): سرفصل کالای در جریان ساخت (۱۴۰۲) — حذف قطعی فالبک اشتباه ۶۰۰۱ (بهای تمام‌شده کالای فروش‌رفته)
    const wipAcc = (await AccountMappingService.getWorkInProgressAccount(tx)) || allAccs.find(a => a.code === '1402');
    const wasteExpenseAcc = allAccs.find(a => a.code === '6003') || allAccs.find(a => a.code === '7009') || allAccs.find(a => a.code === '70');
    const salesReturnAcc = allAccs.find(a => a.code === '5101') || allAccs.find(a => a.code === '51');
    const customerAcc = allAccs.find(a => a.code === '1201') || allAccs.find(a => a.code === '12');
    // V6.0.10 (TD-145): سرفصل بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱) جهت صدور آرتیکل مرجوعی فروش
    const cogsAcc = (await AccountMappingService.getCostOfGoodsSoldAccount(tx)) || allAccs.find(a => a.code === '6001') || allAccs.find(a => a.code === '60');

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
      debit: number;
      credit: number;
      currency?: string;
      exchangeRate?: number;
      description?: string;
    }[] = [];

    if (doc.type === 'remittance') {
      // V9-1.3: جمع مبالغ با FinancialDecimal
      let rawMatCost = fin(0);
      let productCost = fin(0);

      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        // P1-06 (M-07 & F11): حواله مصرف بر مبنای بهای تمام‌شده میانگین موزون (WAC) ارزیابی می‌شود، نه قیمت فروش
        const lineCostRate = Number(line.weightedAverageCost) > 0 ? Number(line.weightedAverageCost) : (Number(line.unitPrice) || 0);
        const cost = fin(q).multiply(lineCostRate);
        if (line.itemType === 'product') {
          productCost = productCost.add(cost);
        } else {
          rawMatCost = rawMatCost.add(cost);
        }
      }

      const rawMatCostNum = rawMatCost.round(4).toNumber();
      const productCostNum = productCost.round(4).toNumber();
      const totalCost = fin(rawMatCostNum).add(productCostNum).round(4).toNumber();
      if (totalCost <= 0) return null;
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

      if (rawMatCostNum > 0) {
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

      if (productCostNum > 0) {
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
      // V9-1.3: جمع مبالغ با FinancialDecimal
      let rawMatWaste = fin(0);
      let productWaste = fin(0);

      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        // P1-06 (M-07 & F11): ثبت هزینه ضایعات بر مبنای بهای تمام‌شده میانگین موزون (WAC)، نه قیمت فروش
        const lineCostRate = Number(line.weightedAverageCost) > 0 ? Number(line.weightedAverageCost) : (Number(line.unitPrice) || 0);
        const cost = fin(q).multiply(lineCostRate);
        if (line.itemType === 'product') {
          productWaste = productWaste.add(cost);
        } else {
          rawMatWaste = rawMatWaste.add(cost);
        }
      }

      const rawMatWasteNum = rawMatWaste.round(4).toNumber();
      const productWasteNum = productWaste.round(4).toNumber();
      const totalWasteAmount = fin(rawMatWasteNum).add(productWasteNum).round(4).toNumber();
      if (totalWasteAmount <= 0) return null;
      if (!wasteExpenseAcc) {
        if (isStrict) {
          throw new ValidationError('سرفصل حسابداری هزینه ضایعات و افت کیفی (۶۰۰۳) در تنظیمات حسابداری یافت نشد.');
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

      if (rawMatWasteNum > 0) {
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

      if (productWasteNum > 0) {
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

      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        const p = Number(line.unitPrice) || 0;
        const d = Number(line.discount) || 0;
        totalReturnAmount = totalReturnAmount.add(fin(q).multiply(p).subtract(d));

        // TD-145: محاسبه بهای تمام‌شده کالای برگشتی بر پایه نرخ WAC
        const wac = Number(line.weightedAverageCost) || 0;
        const lineCost = fin(q).multiply(wac);
        if (line.itemType === 'product') {
          fgReturnCost = fgReturnCost.add(lineCost);
        } else {
          rmReturnCost = rmReturnCost.add(lineCost);
        }
      }

      // TD-143, TD-145 & C-04: تسعیر ارزی بهای تمام‌شده مرجوعی در صورت ارزی بودن سند
      let fgCostConv = fgReturnCost;
      let rmCostConv = rmReturnCost;
      const docCurrency = (doc.currency || 'IRR').toUpperCase();
      let docExchangeRate = 1;

      if (docCurrency !== 'IRR') {
        if (options?.exchangeRate !== undefined && Number(options.exchangeRate) > 0) {
          docExchangeRate = Number(options.exchangeRate);
        } else if (doc.notes) {
          const match = doc.notes.match(/(?:نرخ\s*تسعیر|exchange_?rate)\s*[:=]?\s*([\d,.]+)/i);
          if (match && match[1]) {
            const parsed = Number(match[1].replace(/,/g, ''));
            if (parsed > 0) docExchangeRate = parsed;
          }
        }
        if (docExchangeRate === 1) {
          try {
            const [settingRow] = await executor.select().from(appSettings)
              .where(eq(appSettings.key, `exchange_rate_${docCurrency.toLowerCase()}`));
            if (settingRow && settingRow.value) {
              const val = Number(settingRow.value);
              if (val > 0) docExchangeRate = val;
            }
          } catch {
            // ignore
          }
        }
      }

      if (docCurrency !== 'IRR' && docExchangeRate > 0) {
        if (docExchangeRate >= 1) {
          fgCostConv = fgReturnCost.divide(docExchangeRate);
          rmCostConv = rmReturnCost.divide(docExchangeRate);
        } else {
          fgCostConv = fgReturnCost.multiply(docExchangeRate);
          rmCostConv = rmReturnCost.multiply(docExchangeRate);
        }
      }

      const totalReturnAmountNum = totalReturnAmount.round(4).toNumber();
      const fgCostNum = fgCostConv.round(4).toNumber();
      const rmCostNum = rmCostConv.round(4).toNumber();
      const totalCogsNum = fin(fgCostNum).add(rmCostNum).round(4).toNumber();

      if (!salesReturnAcc || !customerAcc) {
        if (isStrict) {
          throw new ValidationError('سرفصل‌های حسابداری برگشت از فروش (۵۱۰۱) یا حساب‌های دریافتنی تجاری (۱۲۰۱) در تنظیمات حسابداری یافت نشد.');
        }
        return null;
      }

      let matchedCustomerId: number | null = null;
      if (doc.buyerName) {
        const [matchedCust] = await executor.select().from(customers)
          .where(and(eq(customers.name, doc.buyerName.trim()), eq(customers.isDeleted, 0)));
        if (matchedCust) matchedCustomerId = matchedCust.id;
      }

      voucherType = 'sales';
      voucherDescription = `سند برگشت از فروش / مرجوعی شماره ${doc.refNumber} - مشتری: ${doc.buyerName || 'مشتری'}`;

      if (totalReturnAmountNum > 0) {
        // ۱) بدهکار: برگشت از فروش و تخفیفات (۵۱۰۱)
        voucherItems.push({
          accountId: salesReturnAcc.id,
          detailedType: 'other',
          detailedName: 'برگشت از فروش',
          debit: totalReturnAmountNum,
          credit: 0,
          currency: doc.currency || 'IRR',
          exchangeRate: docExchangeRate > 0 ? docExchangeRate : undefined,
          description: `برگشت از فروش بابت سند مرجوعی شماره ${doc.refNumber}`
        });

        // ۲) بستانکار: حساب‌های دریافتنی تجاری / مشتری (۱۲۰۱)
        voucherItems.push({
          accountId: customerAcc.id,
          detailedType: 'customer',
          detailedId: matchedCustomerId || undefined,
          detailedName: doc.buyerName || 'مشتری',
          debit: 0,
          credit: totalReturnAmountNum,
          currency: doc.currency || 'IRR',
          exchangeRate: docExchangeRate > 0 ? docExchangeRate : undefined,
          description: `بستانکاری مشتری بابت مرجوعی کالا در سند شماره ${doc.refNumber}`
        });
      }

      // TD-145: ۳) زوج آرتیکل اصلاح موجودی کالا (بدهکار) و تعدیل بهای تمام‌شده کالای فروش‌رفته (بستانکار)
      if (totalCogsNum > 0) {
        if (!cogsAcc) {
          if (isStrict) {
            throw new ValidationError('سرفصل بهای تمام‌شده کالای فروش‌رفته (۶۰۰۱) برای صدور سند مرجوعی فروش در تنظیمات حسابداری یافت نشد.');
          }
        } else {
          // ۳-الف) بدهکار: افزایش موجودی کالای تولیدشده (۱۴۰۳)
          if (fgCostNum > 0 && finishedGoodsAcc) {
            voucherItems.push({
              accountId: finishedGoodsAcc.id,
              detailedType: 'other',
              detailedName: 'موجودی کالای ساخته‌شده',
              debit: fgCostNum,
              credit: 0,
              currency: doc.currency || 'IRR',
              exchangeRate: docExchangeRate > 0 ? docExchangeRate : undefined,
              description: `افزایش موجودی کالای ساخته‌شده بابت برگشت از فروش سند شماره ${doc.refNumber}`
            });
          }

          // ۳-ب) بدهکار: افزایش موجودی مواد اولیه (۱۴۰۱)
          if (rmCostNum > 0 && rawMaterialAcc) {
            voucherItems.push({
              accountId: rawMaterialAcc.id,
              detailedType: 'other',
              detailedName: 'موجودی مواد اولیه',
              debit: rmCostNum,
              credit: 0,
              currency: doc.currency || 'IRR',
              exchangeRate: docExchangeRate > 0 ? docExchangeRate : undefined,
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
            exchangeRate: docExchangeRate > 0 ? docExchangeRate : undefined,
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

    const existing = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'payroll'),
        eq(journalVouchers.referenceId, payrollId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (existing.length > 0) return VoucherService.getJournalVoucherById(existing[0].id, tx);

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

    const pieceworkAmount = Number(pay.totalPieceworkAmount) || 0;
    const bonuses = Number(pay.totalBonuses) || 0;
    const fixedAmount = Number(pay.totalFixedAmount) || 0;
    const grossAmount = pieceworkAmount + bonuses + fixedAmount;
    if (grossAmount <= 0) return null;

    const items: Array<{
      accountId: number;
      detailedType: 'personnel';
      detailedId: number;
      detailedName: string;
      debit: number;
      credit: number;
      currency: string;
      description: string;
    }> = [];
    // سهم دستمزد مستقیم تولید (کارکرد پرکیسی)
    if (pieceworkAmount > 0) {
      items.push({
        accountId: wageExpenseAcc.id,
        detailedType: 'personnel',
        detailedId: pay.personnelId,
        detailedName: pers?.fullName || 'پرسنل',
        debit: pieceworkAmount,
        credit: 0,
        currency: 'IRR',
        description: `هزینه دستمزد تولیدی پرکیسی فیش ${pay.payrollNumber}`
      });
    }
    // سهم هزینه حقوق ثابت (+ پاداش/اضافه‌کار)
    const fixedBucket = fixedAmount + bonuses;
    if (fixedBucket > 0) {
      items.push({
        accountId: fixedSalaryExpenseAcc.id,
        detailedType: 'personnel',
        detailedId: pay.personnelId,
        detailedName: pers?.fullName || 'پرسنل',
        debit: fixedBucket,
        credit: 0,
        currency: 'IRR',
        description: `هزینه حقوق و دستمزد ثابت فیش ${pay.payrollNumber}${bonuses > 0 ? ' (شامل پاداش/اضافه‌کار)' : ''}`
      });
    }

    // V4.0.33: تفکیک دقیق طرف بستانکار بر مبنای استاندارد حسابداری دوطرفه:
    // ۱. کسر از مساعده پرسنلی (بستانکار حساب 1301 مساعده)
    // ۲. سایر کسورات پرداختنی (بستانکار حساب 3202 کسورات)
    // ۳. خالص حقوق پرداختنی (بستانکار حساب 3201 حقوق پرداختنی)
    const advanceDeduction = Math.max(0, Number(pay.advanceDeduction) || 0);
    const otherDeductions = Math.max(0, Number(pay.totalDeductions) || 0);
    let allocatedCredits = 0;

    if (advanceDeduction > 0) {
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
        allocatedCredits += advanceDeduction;
      } else if (isStrict) {
        throw new ValidationError(`حساب معین مساعده پرسنلی (1301) جهت کسر مساعده فیش ${pay.payrollNumber} یافت نشد.`);
      }
    }

    if (otherDeductions > 0) {
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
          description: `سایر کسورات فیش ${pay.payrollNumber} (${pers?.fullName || 'پرسنل'})`
        });
        allocatedCredits += otherDeductions;
      } else if (isStrict) {
        throw new ValidationError(`حساب معین سایر کسورات پرداختنی (3202) جهت ثبت کسورات فیش ${pay.payrollNumber} یافت نشد.`);
      }
    }

    // بستانکاری خالص حقوق پرداختنی به پرسنل (تضمین موازنه ۱۰۰٪ بدهکار و بستانکار)
    const payableCredit = Math.max(0, grossAmount - allocatedCredits);
    if (payableCredit > 0) {
      items.push({
        accountId: payableAcc.id,
        detailedType: 'personnel',
        detailedId: pay.personnelId,
        detailedName: pers?.fullName || 'پرسنل',
        debit: 0,
        credit: payableCredit,
        currency: 'IRR',
        description: `خالص حقوق و دستمزد پرداختنی به ${pers?.fullName || ''} بابت دوره ${pay.startDate} تا ${pay.endDate}`
      });
    }

    const createdVoucher = await VoucherService.createJournalVoucher({
      // V3.0.7 (TD-062): فال‌بک تاریخ از ساعت توافقی کسب‌وکار (نه UTC خام)
      date: pay.endDate || await businessTodayIsoDate(),
      voucherType: 'payroll',
      status: 'draft',
      description: `ثبت هزینه و محاسبه حقوق و کارمزد پرکیسی ${pay.title} - پرسنل: ${pers?.fullName || 'پرسنل'} (${pay.payrollNumber})`,
      referenceModule: 'payroll',
      referenceId: pay.id,
      referenceNumber: pay.payrollNumber,
      currency: 'IRR',
      userId,
      username,
      items
    }, tx);

    if (!createdVoucher && isStrict) {
      throw new ValidationError(`ثبت سند دوبل حسابداری برای فیش ${pay.payrollNumber} ناموفق بود.`);
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
