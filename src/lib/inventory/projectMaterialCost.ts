/**
 * v10.0.130 (TD-1210): بهای هر تخصیص مواد در فهرست تخصیص‌ها (`GET /inventory/allocations`) همان بهای کاردکس حرکت خروج
 * خود آن است، یعنی همان مبلغی که سند تخصیص به «کالای در جریان ساخت» (۱۴۰۲) می‌برد (TD-286).
 * v10.2.2 (TD-1290): زبانهٔ «ورود به انبار» دیگر جمع تخصیص‌ها را نمی‌سازد و ماندهٔ ۱۴۰۲ پروژه را از
 * `GET /projects/:id/delivery-cost` می‌خواند؛ اینجا فقط قاعدهٔ دسترسی به بها می‌ماند.
 */

/** بها فقط برای خوانندگان بهای کالا (`ITEM_COST_READ_PERMISSIONS`)؛ برای دیگران `cost` از هر ردیف برداشته می‌شود */
export function allocationsForCostAccess<T extends { cost?: number | null }>(allocations: readonly T[], canReadCost: boolean): Array<T | Omit<T, 'cost'>> {
  if (canReadCost) return [...allocations];
  return allocations.map(({ cost: _cost, ...rest }) => rest);
}
