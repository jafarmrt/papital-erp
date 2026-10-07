/**
 * v9.0.277 (TD-580، B03-38): نام فایل خروجی گزارش‌های حسابداری با تاریخ شمسی امروزِ منطقه زمانی توافقی
 * (`getTodayJalaliDate`)، نه روز UTC مرورگر (`new Date().toISOString()`) که بامداد تهران را دیروز می‌نوشت.
 */
const fileDate = (jalaliToday: string) => jalaliToday.replace(/\//g, '-');

export function partyStatementFileName(partyName: string, jalaliToday: string): string {
  return `صورت_حساب_${partyName.trim().replace(/\s+/g, '_')}_${fileDate(jalaliToday)}.csv`;
}

export function accountExplorerFileName(jalaliToday: string): string {
  return `مرور_حساب‌ها_${fileDate(jalaliToday)}.csv`;
}
