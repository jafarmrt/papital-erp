import { orm, type DbExecutor } from '../../db/drizzle.js';
import { 
  documents, 
  documentItems, 
  journalVouchers, 
  customers, 
  personnel, 
  pieceworkPayrolls, 
  items, 
  productionProjects 
} from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { VoucherService } from './voucher.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { logger } from '../../middleware/logger.js';
import { fin } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import type { JournalVoucher } from '../../types.js';

export class VoucherSyncService {
  /**
   * Automatic Double-Entry Journal Voucher for Sales Invoices
   */
  static async syncSalesInvoiceVoucher(docId: number, options?: {
    vatPercent?: number;
    vatAmount?: number;
    userId?: number;
    username?: string;
  }, tx?: DbExecutor): Promise<JournalVoucher | null> {
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, docId));
    if (!doc || doc.isDeleted === 1 || (doc.type !== 'invoice' && doc.type !== 'proforma') || doc.status !== 'final') {
      return null;
    }

    const items = await executor.select().from(documentItems).where(eq(documentItems.documentId, docId));
    if (!items || items.length === 0) return null;

    // V9-1.3: جمع مبالغ با FinancialDecimal — حذف خطای شناور float در مبالغ بزرگ ریالی
    let grossAmount = fin(0);
    let totalDiscount = fin(0);

    for (const it of items) {
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

    let vatAmount = 0;
    if (options?.vatAmount !== undefined && options.vatAmount !== null && !isNaN(Number(options.vatAmount))) {
      vatAmount = Number(options.vatAmount) || 0;
    } else if (options?.vatPercent && !isNaN(Number(options.vatPercent))) {
      vatAmount = fin(netAmount).multiply(Number(options.vatPercent)).divide(100).round(0).toNumber();
    } else if (doc.notes && doc.notes.includes('ارزش افزوده')) {
      const match = doc.notes.match(/ارزش افزوده:\s*([\d,]+)/);
      if (match && match[1]) {
        vatAmount = Number(match[1].replace(/,/g, '')) || 0;
      }
    }

    const finalPayable = fin(netAmount).add(vatAmount).round(4).toNumber();

    // Conceptual Account Resolution (Subphase 9.2)
    const customerAcc = await AccountMappingService.getTradeReceivablesAccount(tx);
    const discountAcc = await AccountMappingService.getSalesDiscountAccount(tx);
    const revenueAcc = await AccountMappingService.getSalesRevenueAccount(tx);
    const vatAcc = await AccountMappingService.getSalesVatPayableAccount(tx);

    if (!customerAcc || !revenueAcc) {
      logger.warn({ message: 'Standard customer or revenue accounts not found for invoice auto voucher' });
      return null;
    }

    let matchedCustomerId: number | null = null;
    if (doc.buyerName) {
      const [matchedCust] = await executor.select().from(customers)
        .where(and(eq(customers.name, doc.buyerName.trim()), eq(customers.isDeleted, 0)));
      if (matchedCust) matchedCustomerId = matchedCust.id;
    }

    // V10-1.1: fallback تاریخ از ساعت توافقی سرور
    const docDate = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : new Date(doc.date).toISOString().split('T')[0]) : await businessTodayIsoDate();

    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: number;
      credit: number;
      currency?: string;
      description?: string;
    }[] = [];

    voucherItems.push({
      accountId: customerAcc.id,
      detailedType: 'customer',
      detailedId: matchedCustomerId || undefined,
      detailedName: doc.buyerName || 'مشتری فاکتور',
      debit: finalPayable,
      credit: 0,
      currency: doc.currency || 'IRR',
      description: `حساب‌های دریافتنی بابت فاکتور فروش شماره ${doc.refNumber}${doc.buyerName ? ` - ${doc.buyerName}` : ''}`
    });

    if (totalDiscountNum > 0 && discountAcc) {
      voucherItems.push({
        accountId: discountAcc.id,
        detailedType: 'other',
        detailedName: 'تخفیفات اعطایی',
        debit: totalDiscountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        description: `تخفیفات اعطایی فاکتور فروش شماره ${doc.refNumber}`
      });
    }

    voucherItems.push({
      accountId: revenueAcc.id,
      detailedType: 'other',
      detailedName: 'درآمد فروش محصولات',
      debit: 0,
      credit: grossAmountNum,
      currency: doc.currency || 'IRR',
      description: `درآمد فروش ناخالص فاکتور شماره ${doc.refNumber}`
    });

    if (vatAmount > 0 && vatAcc) {
      voucherItems.push({
        accountId: vatAcc.id,
        detailedType: 'other',
        detailedName: 'مالیات بر ارزش افزوده',
        debit: 0,
        credit: vatAmount,
        currency: doc.currency || 'IRR',
        description: `مالیات و عوارض بر ارزش افزوده فاکتور شماره ${doc.refNumber}`
      });
    }

    const [existingVoucher] = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));

    if (existingVoucher) {
      if (existingVoucher.status === 'permanent') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      return VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType: 'sales',
        description: `ثبت فاکتور فروش شماره ${doc.refNumber} به نام ${doc.buyerName || 'مشتری'}${totalDiscountNum > 0 ? ' (همراه با تخفیف)' : ''}${vatAmount > 0 ? ' (شامل ارزش‌افزوده)' : ''}`,
        items: voucherItems,
      }, tx);
    } else {
      return VoucherService.createJournalVoucher({
        date: docDate,
        voucherType: 'sales',
        description: `ثبت فاکتور فروش شماره ${doc.refNumber} به نام ${doc.buyerName || 'مشتری'}${totalDiscountNum > 0 ? ' (همراه با تخفیف)' : ''}${vatAmount > 0 ? ' (شامل ارزش‌افزوده)' : ''}`,
        referenceModule: 'invoice',
        referenceId: docId,
        referenceNumber: doc.refNumber,
        currency: doc.currency || 'IRR',
        userId: options?.userId,
        username: options?.username,
        items: voucherItems
      }, tx);
    }
  }

  /**
   * Auto-generate/sync double-entry voucher for purchase invoices / receipts (خرید مواد/کالا و رسید تولید محصولات)
   */
  static async syncPurchaseInvoiceVoucher(docId: number, options?: {
    userId?: number;
    username?: string;
  }, tx?: DbExecutor): Promise<JournalVoucher | null> {
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, docId));
    if (!doc || doc.isDeleted === 1 || !['receipt', 'production_receipt', 'purchase'].includes(doc.type) || doc.status !== 'final') {
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
    .where(eq(documentItems.documentId, docId));

    if (!itemsList || itemsList.length === 0) return null;

    // V9-1.3: جمع مبالغ با FinancialDecimal
    let rawMaterialsAmount = fin(0);
    let finishedGoodsAmount = fin(0);

    for (const it of itemsList) {
      const q = Number(it.quantity) || 0;
      const p = Number(it.unitPrice) > 0 ? Number(it.unitPrice) : (Number(it.weightedAverageCost) || 0);
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

    let matchedProjectId: number | null = null;
    let matchedProjectName: string = '';
    if (doc.notes) {
      const matchProj = String(doc.notes).match(/پروژه\s*[:#]?\s*([A-Za-z0-9-_]+)/i);
      if (matchProj && matchProj[1]) {
        const [p] = await executor.select().from(productionProjects).where(and(eq(productionProjects.projectCode, matchProj[1].trim()), eq(productionProjects.isDeleted, 0)));
        if (p) {
          matchedProjectId = p.id;
          matchedProjectName = p.title || p.projectCode;
        }
      }
    }

    // V10-1.1: fallback تاریخ از ساعت توافقی سرور
    const docDate = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : new Date(doc.date).toISOString().split('T')[0]) : await businessTodayIsoDate();
    const isProduction = doc.type === 'production_receipt';

    const voucherItems: {
      accountId: number;
      detailedType?: 'none' | 'customer' | 'supplier' | 'personnel' | 'project' | 'bank_account' | 'other';
      detailedId?: number;
      detailedName?: string;
      debit: number;
      credit: number;
      currency?: string;
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
          description: `بستانکاری تامین‌کننده بابت فاکتور خرید / رسید ورود کالا و مواد شماره ${doc.refNumber}`
        });
      }
    }

    if (voucherItems.length === 0) return null;

    const voucherType: JournalVoucher['voucherType'] = isProduction ? 'general' : 'purchase';
    const voucherDesc = isProduction 
      ? `ثبت رسید تولید و تحویل محصول نهایی شماره ${doc.refNumber}${matchedProjectName ? ` - پروژه: ${matchedProjectName}` : ''}`
      : `ثبت فاکتور خرید / رسید ورود شماره ${doc.refNumber} - تامین‌کننده: ${doc.buyerName || 'تامین‌کننده'}`;

    const [existingVoucher] = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));

    if (existingVoucher) {
      if (existingVoucher.status === 'permanent') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      return VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType,
        description: voucherDesc,
        items: voucherItems,
      }, tx);
    } else {
      return VoucherService.createJournalVoucher({
        date: docDate,
        voucherType,
        description: voucherDesc,
        referenceModule: 'invoice',
        referenceId: docId,
        referenceNumber: doc.refNumber,
        currency: doc.currency || 'IRR',
        userId: options?.userId,
        username: options?.username,
        items: voucherItems
      }, tx);
    }
  }

  /**
   * Auto-generate/sync double-entry voucher for warehouse documents (حواله خروج مصرف/تولید، ضایعات و مرجوعی)
   */
  static async syncWarehouseDocumentVoucher(docId: number, options?: {
    userId?: number;
    username?: string;
  }, tx?: DbExecutor): Promise<JournalVoucher | null> {
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, docId));
    if (!doc || doc.isDeleted === 1 || doc.status !== 'final') {
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
    .where(eq(documentItems.documentId, docId));

    if (!itemsList || itemsList.length === 0) return null;

    const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
    const rawMaterialAcc = allAccs.find(a => a.code === '1401') || allAccs.find(a => a.code === '14');
    const finishedGoodsAcc = allAccs.find(a => a.code === '1403') || allAccs.find(a => a.code === '14');
    const wipAcc = allAccs.find(a => a.code === '1402') || allAccs.find(a => a.code === '6001') || allAccs.find(a => a.code === '60');
    const wasteExpenseAcc = allAccs.find(a => a.code === '6003') || allAccs.find(a => a.code === '7009') || allAccs.find(a => a.code === '70');
    const salesReturnAcc = allAccs.find(a => a.code === '5101') || allAccs.find(a => a.code === '51');
    const customerAcc = allAccs.find(a => a.code === '1201') || allAccs.find(a => a.code === '12');

    // V10-1.1: fallback تاریخ از ساعت توافقی سرور
    const docDate = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : new Date(doc.date).toISOString().split('T')[0]) : await businessTodayIsoDate();

    let matchedProjectId: number | null = null;
    let matchedProjectName: string = '';
    if (doc.notes) {
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
      description?: string;
    }[] = [];

    if (doc.type === 'remittance') {
      // V9-1.3: جمع مبالغ با FinancialDecimal
      let rawMatCost = fin(0);
      let productCost = fin(0);

      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        const linePrice = Number(line.unitPrice) > 0 ? Number(line.unitPrice) : (Number(line.weightedAverageCost) || 0);
        const cost = fin(q).multiply(linePrice);
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
      if (!wipAcc) return null;

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

      if (rawMatCostNum > 0 && rawMaterialAcc) {
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

      if (productCostNum > 0 && finishedGoodsAcc) {
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

    } else if (doc.type === 'waste') {
      // V9-1.3: جمع مبالغ با FinancialDecimal
      let rawMatWaste = fin(0);
      let productWaste = fin(0);

      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        const linePrice = Number(line.unitPrice) > 0 ? Number(line.unitPrice) : (Number(line.weightedAverageCost) || 0);
        const cost = fin(q).multiply(linePrice);
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
      if (!wasteExpenseAcc) return null;

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

      if (rawMatWasteNum > 0 && rawMaterialAcc) {
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

      if (productWasteNum > 0 && finishedGoodsAcc) {
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

    } else if (doc.type === 'return') {
      // V9-1.3: جمع مبالغ با FinancialDecimal
      let totalReturnAmount = fin(0);
      for (const line of itemsList) {
        const q = Number(line.quantity) || 0;
        const p = Number(line.unitPrice) || 0;
        const d = Number(line.discount) || 0;
        totalReturnAmount = totalReturnAmount.add(fin(q).multiply(p).subtract(d));
      }

      const totalReturnAmountNum = totalReturnAmount.round(4).toNumber();

      if (totalReturnAmountNum <= 0) return null;
      if (!salesReturnAcc || !customerAcc) return null;

      let matchedCustomerId: number | null = null;
      if (doc.buyerName) {
        const [matchedCust] = await executor.select().from(customers)
          .where(and(eq(customers.name, doc.buyerName.trim()), eq(customers.isDeleted, 0)));
        if (matchedCust) matchedCustomerId = matchedCust.id;
      }

      voucherType = 'sales';
      voucherDescription = `سند برگشت از فروش / مرجوعی شماره ${doc.refNumber} - مشتری: ${doc.buyerName || 'مشتری'}`;

      voucherItems.push({
        accountId: salesReturnAcc.id,
        detailedType: 'other',
        detailedName: 'برگشت از فروش',
        debit: totalReturnAmountNum,
        credit: 0,
        currency: doc.currency || 'IRR',
        description: `برگشت از فروش بابت سند مرجوعی شماره ${doc.refNumber}`
      });

      voucherItems.push({
        accountId: customerAcc.id,
        detailedType: 'customer',
        detailedId: matchedCustomerId || undefined,
        detailedName: doc.buyerName || 'مشتری',
        debit: 0,
        credit: totalReturnAmountNum,
        currency: doc.currency || 'IRR',
        description: `بستانکاری مشتری بابت مرجوعی کالا در سند شماره ${doc.refNumber}`
      });
    } else {
      return null;
    }

    if (voucherItems.length === 0) return null;

    const [existingVoucher] = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, docId),
        eq(journalVouchers.isDeleted, 0)
      ));

    if (existingVoucher) {
      if (existingVoucher.status === 'permanent') {
        return VoucherService.getJournalVoucherById(existingVoucher.id, tx);
      }
      return VoucherService.updateJournalVoucher(existingVoucher.id, {
        date: docDate,
        voucherType,
        description: voucherDescription,
        items: voucherItems,
      }, tx);
    } else {
      return VoucherService.createJournalVoucher({
        date: docDate,
        voucherType,
        description: voucherDescription,
        referenceModule: 'invoice',
        referenceId: docId,
        referenceNumber: doc.refNumber,
        currency: doc.currency || 'IRR',
        userId: options?.userId,
        username: options?.username,
        items: voucherItems
      }, tx);
    }
  }

  /**
   * Auto-generate double-entry voucher when a document is finalized
   */
  static async autoCreateVoucherForInvoice(documentId: number, userId?: number, username?: string, tx?: DbExecutor): Promise<JournalVoucher | null> {
    const executor = tx || orm;
    const [doc] = await executor.select().from(documents).where(eq(documents.id, documentId));
    if (!doc || doc.isDeleted === 1 || doc.status !== 'final') return null;

    const existing = await executor.select().from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'invoice'),
        eq(journalVouchers.referenceId, documentId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (existing.length > 0) return VoucherService.getJournalVoucherById(existing[0].id, tx);

    if (doc.type === 'invoice') {
      return this.syncSalesInvoiceVoucher(documentId, { userId, username }, tx);
    } else if (doc.type === 'receipt' || doc.type === 'production_receipt' || doc.type === 'purchase') {
      return this.syncPurchaseInvoiceVoucher(documentId, { userId, username }, tx);
    } else if (['remittance', 'waste', 'return'].includes(doc.type)) {
      return this.syncWarehouseDocumentVoucher(documentId, { userId, username }, tx);
    }

    return null;
  }

  /**
   * Auto-generate double-entry voucher when piecework payroll is approved/paid
   */
  static async autoCreateVoucherForPayroll(payrollId: number, userId?: number, username?: string, tx?: DbExecutor): Promise<JournalVoucher | null> {
    const executor = tx || orm;
    const [pay] = await executor.select().from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollId));
    if (!pay || pay.isDeleted === 1) return null;

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
      logger.warn({ message: 'Conceptual payroll accounts not found for payroll auto voucher (wages payable / fixed salary expense / production wages)' });
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
    // بستانکاری حقوق پرداختنی (ناخالص)
    items.push({
      accountId: payableAcc.id,
      detailedType: 'personnel',
      detailedId: pay.personnelId,
      detailedName: pers?.fullName || 'پرسنل',
      debit: 0,
      credit: grossAmount,
      currency: 'IRR',
      description: `بستانکاری حقوق و دستمزد ${pers?.fullName || ''} بابت دوره ${pay.startDate} تا ${pay.endDate}`
    });

    return VoucherService.createJournalVoucher({
      // V3.0.7 (TD-062): فال‌بک تاریخ از ساعت توافقی کسب‌وکار (نه UTC خام)
      date: pay.endDate || await businessTodayIsoDate(),
      voucherType: 'payroll',
      description: `ثبت هزینه و محاسبه حقوق و کارمزد پرکیسی ${pay.title} - پرسنل: ${pers?.fullName || 'پرسنل'} (${pay.payrollNumber})`,
      referenceModule: 'payroll',
      referenceId: pay.id,
      referenceNumber: pay.payrollNumber,
      currency: 'IRR',
      userId,
      username,
      items
    }, tx);
  }

  /**
   * Sync all final sales & purchase invoices to update double-entry vouchers
   */
  static async syncAllInvoiceVouchers(tx?: DbExecutor): Promise<number> {
    try {
      const executor = tx || orm;
      const finalDocs = await executor.select({ id: documents.id, type: documents.type })
        .from(documents)
        .where(and(
          inArray(documents.type, ['invoice', 'receipt', 'remittance', 'waste', 'return']),
          eq(documents.status, 'final'),
          eq(documents.isDeleted, 0)
        ));
      
      let syncedCount = 0;
      for (const d of finalDocs) {
        try {
          if (d.type === 'invoice') {
            await this.syncSalesInvoiceVoucher(d.id, undefined, tx);
          } else if (d.type === 'receipt' || d.type === 'production_receipt' || d.type === 'purchase') {
            await this.syncPurchaseInvoiceVoucher(d.id, undefined, tx);
          } else if (['remittance', 'waste', 'return'].includes(d.type)) {
            await this.syncWarehouseDocumentVoucher(d.id, undefined, tx);
          }
          syncedCount++;
        } catch (docErr) {
          logger.warn({ message: `[VoucherSync] Skipped doc ${d.id}`, error: docErr });
        }
      }
      return syncedCount;
    } catch (err: unknown) {
      logger.error({ message: 'Error syncing all invoice vouchers', error: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  }
}
