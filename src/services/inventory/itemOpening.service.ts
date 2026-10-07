import { orm, DbExecutor } from '../../db/drizzle.js';
import { items, journalVouchers } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { businessTodayJalaliDash } from '../../lib/businessClock.js';
import type { JournalVoucher } from '../../types.js';
import { openingKardexValue } from './itemOpeningValue.js';
import { ValidationError } from '../../errors/customErrors.js';

/**
 * V2.0.0: سند افتتاحیه موجودی اولیه کالا — اتمیک و idempotent
 * DR موجودی مواد اولیه (1401) یا کالای تولیدشده (1403) / CR سرمایه اولیه (4001)، به ارزش ردیف‌های افتتاحیه کاردکس
 * (v9.0.93، TD-481)
 */
export class ItemOpeningService {
  static async issueItemOpeningVoucher(itemId: number, params: { userId?: number; username?: string; tx?: DbExecutor } = {}): Promise<JournalVoucher | null> {
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

    // v9.0.93 (TD-481، تصمیم ت۴): ارزش = جمع ردیف‌های افتتاحیه کاردکس همین کالا (مقدار × بهای ثبت‌شده هنگام ساخت)، با گردش
    // کار یا بی آن یکی. پیش‌تر «موجودی جاری × WAC جاری» بود و رسید ثبت‌شده پیش از تأیید دوباره به سرمایه اولیه می‌رفت.
    const opening = await openingKardexValue(executor, itemId);
    const amount = opening.value;
    if (!amount.isPositive() || !opening.quantity.isPositive()) return null; // ردیف افتتاحیه با بها ندارد — سند ندارد
    const unitCost = amount.divide(opening.quantity).round(4);

    const inventoryAcc = item.type === 'raw_material'
      ? await AccountMappingService.getInventoryRawMaterialsAccount(params.tx)
      : await AccountMappingService.getInventoryFinishedGoodsAccount(params.tx);
    const capitalAcc = await AccountMappingService.getOpeningCapitalAccount(params.tx);
    if (!inventoryAcc || !capitalAcc) {
      // v9.0.169 (TD-652): خطای قابل‌نمایش به کاربر (422)؛ ثبت کالا با موجودی اولیه رد می‌شود
      throw new ValidationError('حساب «موجودی» یا «سرمایه اولیه» در چارت یافت نشد — از تنظیمات ← تنظیمات حسابداری پیکربندی کنید');
    }

    // v9.0.93 (TD-481): ردیف کاردکس تغییرناپذیر است؛ پیش‌تر بهای ردیف‌های افتتاحیه (و هر ردیف انبارگردانی با بهای ۰) با WAC
    // روز بازنویسی می‌شد و بازپخش کاردکس دیگر به WAC جاری نمی‌رسید (I13).
    const voucher = await VoucherService.createJournalVoucher({
      date: await businessTodayJalaliDash(),
      voucherType: 'opening',
      status: 'draft',
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
          description: `موجودی اولیه ${opening.quantity.toString()} ${item.unit} × ${unitCost.toString()} — ${item.name}`
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
