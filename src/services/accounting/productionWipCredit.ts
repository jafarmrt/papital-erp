import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { productionReceiptCosts } from '../../db/schema.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { ValidationError } from '../../errors/customErrors.js';
import type { Account } from '../../types.js';
import { AccountMappingService } from './accountMapping.service.js';

export interface ProductionCreditRow {
  accountId: number;
  detailedType: 'project';
  detailedId: number;
  detailedName: string;
  debit: DecimalValue;
  credit: DecimalValue;
  currency: string;
  exchangeRate: DecimalValue;
  description: string;
}

export interface ProductionCreditInput {
  documentId: number;
  refNumber: string;
  currency: string;
  projectId: number;
  /** the project's title, or '' */
  projectName: string;
  detailedName: string;
  wipAccount: Account;
  /** the lines' value, which the inventory rows debit */
  totalGross: FinancialDecimal;
  /** the rate of a row worth `totalGross` */
  totalGrossRate: DecimalValue;
  strict: boolean;
}

/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): the credit side of a project's production receipt. The receipt was priced under the
 * project lock and `production_receipt_costs` holds what it takes from the project's work in progress (1402); the voucher
 * credits 1402 with exactly that, so the project's 1402 closes with the receipt that completes its plan, and posts the
 * difference to the lines' value (a cost entered with a reason, a receipt without 1402, rounding of the unit cost) on
 * «اختلاف بهای تولید» (mapping `productionVarianceAccountCode`, default 6005): a credit when the goods enter above what
 * 1402 gave, a debit below. The receipt that completes the plan of a project whose 1402 is below zero debits 1402 back to
 * zero. A difference under the voucher tolerance stays on 1402, and so does a difference of the unit cost's rounding alone
 * (no reason was asked) when the install has no variance account (review of S2). A receipt recorded before, or one without
 * a rial cost row, credits 1402 with the lines' value as before.
 */
export async function projectProductionCreditRows(executor: DbExecutor, input: ProductionCreditInput): Promise<ProductionCreditRow[]> {
  const projectNote = input.projectName ? ` (پروژه: ${input.projectName})` : '';
  const row = (account: Account, debit: DecimalValue, credit: DecimalValue, exchangeRate: DecimalValue, description: string): ProductionCreditRow => ({
    accountId: account.id, detailedType: 'project', detailedId: input.projectId, detailedName: input.detailedName,
    debit, credit, currency: input.currency, exchangeRate, description,
  });
  const wipDescription = `انتقال بهای تمام شده از کالای در جریان ساخت به انبار بابت رسید تولید شماره ${input.refNumber}${projectNote}`;
  const asBefore = () => [row(input.wipAccount, 0, input.totalGross, input.totalGrossRate, wipDescription)];

  const [cost] = await executor.select({ wipCredit: productionReceiptCosts.wipCredit, reason: productionReceiptCosts.reason })
    .from(productionReceiptCosts).where(eq(productionReceiptCosts.documentId, input.documentId));
  if (!cost || input.currency !== 'IRR') return asBefore();

  const wipCredit = fin(cost.wipCredit).round(4);
  const variance = input.totalGross.subtract(wipCredit).round(4);
  if (variance.abs().lessThan(VOUCHER_BALANCE_TOLERANCE)) return asBefore();

  const varianceAccount = await AccountMappingService.getProductionVarianceAccount(executor);
  if (!varianceAccount) {
    if (input.strict && cost.reason) {
      throw new ValidationError('سرفصل حسابداری «اختلاف بهای تولید» (6005) برای صدور سند رسید تولید پروژه یافت نشد؛ آن را در کدینگ یا نگاشت حساب‌ها تعریف کنید.');
    }
    return asBefore();
  }
  const rows: ProductionCreditRow[] = [];
  if (wipCredit.isPositive()) rows.push(row(input.wipAccount, 0, wipCredit, 1, wipDescription));
  if (wipCredit.isNegative()) {
    rows.push(row(input.wipAccount, wipCredit.abs(), 0, 1, `بستن ماندهٔ زیر صفر کالای در جریان ساخت با رسید تولید شماره ${input.refNumber}${projectNote}`));
  }
  const reasonNote = cost.reason ? ` — ${cost.reason}` : '';
  rows.push(row(
    varianceAccount,
    variance.isNegative() ? variance.abs() : 0,
    variance.isPositive() ? variance : 0,
    1,
    `اختلاف بهای رسید تولید شماره ${input.refNumber} با کالای در جریان ساخت${projectNote}${reasonNote}`,
  ));
  return rows;
}
