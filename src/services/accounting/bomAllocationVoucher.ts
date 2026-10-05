import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';
import { AccountMappingService } from './accountMapping.service.js';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';
import { VoucherService } from './voucher.service.js';

/**
 * v8.0.34 (TD-286، تصمیم مالک محصول — گزینه الف): سند حسابداری تخصیص مواد BOM به پروژه. پیش‌تر تخصیص موجودی را به بهای
 * میانگین کم می‌کرد ولی سندی نداشت و موجودی مواد دفتر کل کم نمی‌شد.
 *   تخصیص: بدهکار کالای در جریان ساخت (۱۴۰۲، تفصیلی پروژه) / بستانکار موجودی مواد (۱۴۰۱) یا کالای ساخته‌شده (۱۴۰۳)، به بهای
 *   کاردکس همان خروج؛ سند خودکار پیش‌نویس است و با journal_vouchers.source_bom_allocation_id به تخصیص پیوند دارد (مهاجرت 0049).
 *   آزادسازی: همان سند با قاعده مشترک ابطال (voidSourceVoucher) باطل می‌شود — پیش‌نویس حذف نرم، تأییدشده سند معکوس.
 *   مصرف: سندی ندارد؛ مواد در ۱۴۰۲ می‌مانند تا رسید تولید آن را به کالای ساخته‌شده ببرد.
 */
export async function issueBomAllocationVoucher(tx: DbExecutor, params: {
  allocationId: number;
  projectId: number;
  projectLabel: string;
  itemName: string;
  itemType: string | null;
  amount: DecimalValue;
  date: string;
  userId?: number | null;
  username?: string;
}): Promise<number | null> {
  const amount = fin(params.amount).round(4);
  if (!amount.isPositive()) return null;

  const allAccs = await ChartOfAccountsService.getAllAccounts(tx);
  const wipAcc = (await AccountMappingService.getWorkInProgressAccount(tx)) || allAccs.find(a => a.code === '1402');
  const inventoryAcc = params.itemType === 'product'
    ? (await AccountMappingService.getInventoryFinishedGoodsAccount(tx)) || allAccs.find(a => a.code === '1403')
    : (await AccountMappingService.getInventoryRawMaterialsAccount(tx)) || allAccs.find(a => a.code === '1401');
  if (!wipAcc) throw new ValidationError('سرفصل حسابداری کالای در جریان ساخت (۱۴۰۲) برای سند تخصیص مواد پروژه یافت نشد.');
  if (!inventoryAcc) throw new ValidationError('سرفصل حسابداری موجودی مواد یا کالا برای سند تخصیص مواد پروژه یافت نشد.');

  const description = `تخصیص «${params.itemName}» به پروژه ${params.projectLabel} (تخصیص شماره ${params.allocationId})`;
  const voucher = await VoucherService.createJournalVoucher({
    date: params.date,
    voucherType: 'general',
    status: 'draft',
    description,
    referenceModule: 'inventory',
    referenceId: params.allocationId,
    referenceNumber: `BOM-${params.allocationId}`,
    sourceBomAllocationId: params.allocationId,
    currency: 'IRR',
    userId: params.userId ?? undefined,
    username: params.username,
    items: [
      {
        accountId: wipAcc.id,
        detailedType: 'project',
        detailedId: params.projectId,
        detailedName: params.projectLabel,
        debit: amount,
        credit: 0,
        currency: 'IRR',
        description,
      },
      {
        accountId: inventoryAcc.id,
        detailedType: 'other',
        detailedName: params.itemName,
        debit: 0,
        credit: amount,
        currency: 'IRR',
        description,
      },
    ],
  }, tx);
  return voucher.id;
}

/** ابطال سند(های) فعال یک تخصیص با قاعده مشترک ابطال (پیش‌نویس حذف نرم، تأییدشده سند معکوس) */
export async function voidBomAllocationVouchers(tx: DbExecutor, allocationId: number, reason: string, user: { userId?: number | null; username?: string }): Promise<void> {
  const linked = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
    .where(and(eq(journalVouchers.sourceBomAllocationId, allocationId), eq(journalVouchers.isDeleted, 0)));
  for (const v of linked) {
    await VoucherService.voidSourceVoucher({ voucherId: v.id, reason, userId: user.userId ?? undefined, username: user.username, externalTx: tx });
  }
}
