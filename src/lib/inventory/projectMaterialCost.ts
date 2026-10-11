/**
 * v10.0.130 (TD-1210): جمع بهای مواد تخصیص‌یافته به پروژه برای زبانه «ورود به انبار».
 * بهای هر تخصیص همان بهای کاردکس حرکت خروج خود آن است (مقدار × بهای واحد ردیف کاردکس)، یعنی همان مبلغی که سند تخصیص
 * به «کالای در جریان ساخت» (۱۴۰۲) می‌برد (TD-286)؛ تخصیص آزادشده بهایی ندارد، چون سندش باطل شده است.
 * پیش‌تر کاربر این جمع را فقط از کارت حساب ۱۴۰۲ پیدا می‌کرد تا بهای واحد محصول را بنویسد.
 */
import { fin } from '../financialDecimal.js';

export interface AllocationCostRow {
  status: string;
  /** بهای کاردکس خروج تخصیص به ریال؛ null برای تخصیص بی‌حرکت خروج (پیش از v8.0.32) یا خواننده بی مجوز بها */
  cost?: number | null;
}

export interface ProjectMaterialCost {
  /** جمع بهای تخصیص‌های آزادنشده به ریال */
  total: number;
  /** شمار تخصیص‌هایی که در جمع آمده‌اند */
  counted: number;
  /** شمار تخصیص‌های آزادنشده‌ای که بها ندارند و در جمع نیامده‌اند */
  withoutCost: number;
}

export function projectMaterialCost(allocations: readonly AllocationCostRow[]): ProjectMaterialCost {
  let total = fin(0);
  let counted = 0;
  let withoutCost = 0;
  for (const allocation of allocations) {
    if (allocation.status === 'released') continue;
    if (typeof allocation.cost !== 'number' || !Number.isFinite(allocation.cost)) {
      withoutCost += 1;
      continue;
    }
    total = total.add(allocation.cost);
    counted += 1;
  }
  return { total: total.toNumber(), counted, withoutCost };
}

/** بهای هر واحد وقتی همه مواد به یک محصول با این تیراژ برسد (گرد به ریال)؛ null بی تیراژ یا بی بها */
export function materialCostPerUnit(total: number, quantity: number): number | null {
  if (!(quantity > 0) || !(total > 0)) return null;
  return fin(total).divide(quantity, 0).toNumber();
}

/** بها فقط برای خوانندگان بهای کالا (`ITEM_COST_READ_PERMISSIONS`)؛ برای دیگران `cost` از هر ردیف برداشته می‌شود */
export function allocationsForCostAccess<T extends { cost?: number | null }>(allocations: readonly T[], canReadCost: boolean): Array<T | Omit<T, 'cost'>> {
  if (canReadCost) return [...allocations];
  return allocations.map(({ cost: _cost, ...rest }) => rest);
}
