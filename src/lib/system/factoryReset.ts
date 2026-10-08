/**
 * v9.0.360 (TD-620، B01-40): متن کارت بازنشانی کامل، همان کاری که `FactoryResetService.wipeAndReseed` می‌کند: داده
 * پایه با `runSeed` و گردش کارها، قاعده‌های رویداد و اشتراک‌های پیش‌فرض با `seedDefaultEngines` (همان بوت) برمی‌گردند و
 * نقش‌ها می‌مانند (TD-245). کارت پیش‌تر می‌گفت «نقش‌های سیستمی» بازنشانی می‌شوند و قاعده‌ها و اشتراک‌ها تا راه‌اندازی
 * دوباره کارساز نبودند.
 */

/** What the reset erases */
export const FACTORY_RESET_ERASED = [
  'کالاها', 'انبارها', 'فاکتورها', 'اسناد حسابداری', 'چک‌ها', 'پروژه‌ها', 'ارتباط با مشتری', 'کارکردها', 'همه حساب‌های کاربری',
] as const;

/** The defaults the reset puts back, as a fresh install has them */
export const FACTORY_RESET_RESTORED = [
  '۲۲ دسته‌بندی کالا', 'تنظیمات پیش‌فرض', 'کارهای کارمزدی', 'درخت حساب‌ها', 'گردش کارها', 'قاعده‌های رویداد', 'اشتراک‌های وبهوک پیش‌فرض',
] as const;

/** What the reset keeps */
export const FACTORY_RESET_KEPT = 'نقش‌ها و مجوزهای آن‌ها';

/**
 * v9.0.362 (TD-622، B01-42، تصمیم ت۸): برای بازنشانی کامل کاربر عبارت «حذف همه» را می‌نویسد (پیش‌تر «DELETE» با حروف
 * بزرگ لاتین). فاصله‌های دو سر و فاصله‌های تکراری میان دو واژه نادیده گرفته می‌شوند.
 */
export const FACTORY_RESET_CONFIRM_WORD = 'حذف همه';

export function isFactoryResetConfirmed(text: string): boolean {
  return String(text ?? '').trim().replace(/\s+/g, ' ') === FACTORY_RESET_CONFIRM_WORD;
}
