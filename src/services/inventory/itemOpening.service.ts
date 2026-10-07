import { orm, DbExecutor } from '../../db/drizzle.js';
import { itemOpeningVoucherItems, items, journalVouchers } from '../../db/schema.js';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { businessTodayJalaliDash } from '../../lib/businessClock.js';
import type { JournalVoucher } from '../../types.js';
import { openingKardexValue, openingKardexValues } from './itemOpeningValue.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';

const ACCOUNTS_MISSING_MESSAGE = 'حساب «موجودی» یا «سرمایه اولیه» در چارت یافت نشد — از تنظیمات ← تنظیمات حسابداری پیکربندی کنید';

/**
 * v9.0.199 (TD-663): کالاهایی از این فهرست که سند افتتاحیه فعال دارند. سند یک کالا و سند یک ورود اکسل هر دو در
 * `item_opening_voucher_items` (مهاجرت 0073) ثبت می‌شوند؛ سندهای پیشین با `reference_id` در مهاجرت پر شدند.
 */
export async function itemIdsWithOpeningVoucher(executor: DbExecutor, itemIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(itemIds.filter(id => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Set();
  const rows = await executor.selectDistinct({ itemId: itemOpeningVoucherItems.itemId })
    .from(itemOpeningVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, itemOpeningVoucherItems.voucherId))
    .where(and(inArray(itemOpeningVoucherItems.itemId, ids), eq(journalVouchers.isDeleted, 0)));
  return new Set(rows.map(r => r.itemId));
}

async function liveOpeningVoucherId(executor: DbExecutor, itemId: number): Promise<number | null> {
  const [row] = await executor.select({ id: journalVouchers.id })
    .from(itemOpeningVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, itemOpeningVoucherItems.voucherId))
    .where(and(eq(itemOpeningVoucherItems.itemId, itemId), eq(journalVouchers.isDeleted, 0)))
    .orderBy(asc(journalVouchers.id))
    .limit(1);
  return row?.id ?? null;
}

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

    // idempotency: سند فعال این کالا، سند خودش یا سند ورود اکسل (v9.0.199، TD-663)
    const existingId = await liveOpeningVoucherId(executor, itemId);
    if (existingId) return VoucherService.getJournalVoucherById(existingId, params.tx);

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
      throw new ValidationError(ACCOUNTS_MISSING_MESSAGE);
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

    await executor.insert(itemOpeningVoucherItems).values({ voucherId: voucher.id, itemId, amount: money(amount) });
    return voucher;
  }

  /**
   * v9.0.199 (TD-663، B05-17، تصمیم ت۱۰ بند ۳): یک سند افتتاحیه برای همه کالاهای تازه یک ورود اکسل، با یک ردیف بدهکار
   * برای هر کالا (به ارزش ردیف‌های افتتاحیه کاردکس همان کالا) و یک ردیف بستانکار سرمایه اولیه. پیش‌تر هر کالای تازه سند
   * جدا می‌گرفت و فایل ۱٬۰۰۰ ردیفی ۹۹۹ سند می‌ساخت که حسابدار یکی‌یکی تأیید می‌کرد. کالایی که سند فعال دارد یا ردیف
   * افتتاحیه با بها ندارد کنار می‌ماند؛ بی هیچ کالای با ارزش، سندی صادر نمی‌شود.
   */
  static async issueImportOpeningVoucher(tx: DbExecutor, itemIds: number[], params: { userId?: number; username?: string } = {}): Promise<JournalVoucher | null> {
    const ids = [...new Set(itemIds)].sort((a, b) => a - b);
    if (ids.length === 0) return null;
    const alreadyIssued = await itemIdsWithOpeningVoucher(tx, ids);
    const pending = ids.filter(id => !alreadyIssued.has(id));
    if (pending.length === 0) return null;
    const rows = await tx.select({ id: items.id, code: items.code, name: items.name, unit: items.unit, type: items.type })
      .from(items).where(and(inArray(items.id, pending), eq(items.isDeleted, 0))).orderBy(asc(items.id));
    const values = await openingKardexValues(tx, rows.map(r => r.id));
    const lines = rows.flatMap(item => {
      const v = values.get(item.id);
      return v && v.value.isPositive() && v.quantity.isPositive() ? [{ item, quantity: v.quantity, value: v.value }] : [];
    });
    if (lines.length === 0) return null;

    const capitalAcc = await AccountMappingService.getOpeningCapitalAccount(tx);
    const rawAcc = lines.some(l => l.item.type === 'raw_material') ? await AccountMappingService.getInventoryRawMaterialsAccount(tx) : null;
    const goodsAcc = lines.some(l => l.item.type !== 'raw_material') ? await AccountMappingService.getInventoryFinishedGoodsAccount(tx) : null;
    const accountOf = (type: string) => (type === 'raw_material' ? rawAcc : goodsAcc);
    if (!capitalAcc || lines.some(l => !accountOf(l.item.type))) throw new ValidationError(ACCOUNTS_MISSING_MESSAGE);

    const total = lines.reduce<FinancialDecimal>((sum, l) => sum.add(l.value), fin(0));
    const debitRows = lines.map(l => ({
      accountId: accountOf(l.item.type)?.id ?? capitalAcc.id,
      detailedType: 'other',
      detailedName: `موجودی اولیه ${l.item.name}`,
      debit: l.value,
      credit: 0,
      currency: 'IRR',
      description: `موجودی اولیه ${l.quantity.toString()} ${l.item.unit} × ${l.value.divide(l.quantity).round(4).toString()} — ${l.item.name} (${l.item.code})`,
    }));
    const voucher = await VoucherService.createJournalVoucher({
      date: await businessTodayJalaliDash(),
      voucherType: 'opening',
      status: 'draft',
      description: `سند افتتاحیه موجودی اولیه ${lines.length} کالای تازه از ورود اکسل`,
      referenceModule: 'item_opening',
      referenceId: null,
      referenceNumber: 'درون‌ریزی اکسل',
      currency: 'IRR',
      userId: params.userId,
      username: params.username,
      items: [
        ...debitRows,
        {
          accountId: capitalAcc.id,
          detailedType: 'other',
          detailedName: 'سرمایه اولیه',
          debit: 0,
          credit: total,
          currency: 'IRR',
          description: `ثبت ارزش موجودی اولیه ${lines.length} کالای ورود اکسل در سرمایه`,
        },
      ],
    }, tx);

    await tx.insert(itemOpeningVoucherItems).values(lines.map(l => ({ voucherId: voucher.id, itemId: l.item.id, amount: money(l.value) })));
    return voucher;
  }
}
