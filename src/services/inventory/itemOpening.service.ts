import { orm } from '../../db/drizzle.js';
import { items, journalVouchers, transactions } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { logger } from '../../middleware/logger.js';
import { businessTodayJalaliDash } from '../../lib/businessClock.js';
import type { JournalVoucher } from '../../types.js';

/**
 * V2.0.0: سند افتتاحیه موجودی اولیه کالا — اتمیک و idempotent
 * DR موجودی مواد اولیه (1401) یا کالای تولیدشده (1403) × (موجودی × WAC) / CR سرمایه اولیه (4001)
 * + اصلاح unitPrice تراکنش‌های «ثبت اولیه کالا» (قبلاً صفر ثبت می‌شد و WAC را خراب می‌کرد)
 */
export class ItemOpeningService {
  static async issueItemOpeningVoucher(itemId: number, params: { userId?: number; username?: string; tx?: any } = {}): Promise<JournalVoucher | null> {
    const executor = params.tx || orm;
    const [item] = await executor.select().from(items).where(eq(items.id, itemId));
    if (!item || item.isDeleted === 1) return null;

    // idempotency
    const [existing] = await executor.select({ id: journalVouchers.id })
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'item_opening'),
        eq(journalVouchers.referenceId, itemId),
        eq(journalVouchers.isDeleted, 0)
      ));
    if (existing) return VoucherService.getJournalVoucherById(existing.id, params.tx);

    const stock = Number(item.currentStock) || 0;
    const wac = Number(item.weightedAverageCost) || 0;
    const amount = Math.round(stock * wac * 10000) / 10000;
    if (amount <= 0) return null; // موجودی اولیه یا WAC ندارد — سند ندارد

    const inventoryAcc = item.type === 'raw_material'
      ? await AccountMappingService.getInventoryRawMaterialsAccount(params.tx)
      : await AccountMappingService.getInventoryFinishedGoodsAccount(params.tx);
    const capitalAcc = await AccountMappingService.getOpeningCapitalAccount(params.tx);
    if (!inventoryAcc || !capitalAcc) {
      throw new Error('حساب «موجودی» یا «سرمایه اولیه» در چارت یافت نشد — از تنظیمات ← تنظیمات حسابداری پیکربندی کنید');
    }

    // اصلاح unitPrice تراکنش‌های «ثبت اولیه کالا» (قبلاً صفر بود)
    try {
      await executor.update(transactions)
        .set({ unitPrice: wac })
        .where(and(eq(transactions.itemId, itemId), eq(transactions.documentType, 'audit')));
    } catch (err: any) {
      logger.warn({ message: `Could not update audit tx unit price for item ${itemId}`, error: err });
    }

    const voucher = await VoucherService.createJournalVoucher({
      date: await businessTodayJalaliDash(),
      voucherType: 'opening',
      description: `سند افتتاحیه موجودی اولیه کالا «${item.name}» (${item.code})`,
      referenceModule: 'item_opening',
      referenceId: itemId,
      referenceNumber: item.code,
      currency: 'IRR',
      userId: params.userId,
      username: params.username,
      items: [
        {
          accountId: inventoryAcc.id,
          detailedType: 'other',
          detailedName: `موجودی اولیه ${item.name}`,
          debit: amount,
          credit: 0,
          currency: 'IRR',
          description: `موجودی اولیه ${stock} ${item.unit} × ${wac} — ${item.name}`
        },
        {
          accountId: capitalAcc.id,
          detailedType: 'other',
          detailedName: 'سرمایه اولیه',
          debit: 0,
          credit: amount,
          currency: 'IRR',
          description: `ثبت ارزش موجودی اولیه ${item.name} در سرمایه`
        }
      ]
    }, params.tx);

    return voucher;
  }
}
