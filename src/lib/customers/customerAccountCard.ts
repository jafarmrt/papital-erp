/**
 * v9.0.4 (TD-416، تصمیم مالک محصول ت۱ الف): کارت حساب و مانده طرف حساب با شناسه او (GET /customers/:id/account-card).
 * پیش‌تر صفحه طرف حساب‌ها فقط نام را به کارت حساب گزارش‌های مالی می‌فرستاد و مانده هر طرف حسابی که نامش این نام را
 * داشت جمع می‌شد؛ پرونده مشتری نام را با شناسه AND می‌کرد و پس از تغییر نام صفر نشان می‌داد.
 */
export function customerAccountCardUrl(customerId: number): string {
  return `/customers/${customerId}/account-card`;
}
