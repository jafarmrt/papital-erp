/**
 * v10.0.18 (D-11، طرح MOBILE_WORKSHOP_PLAN.md بخش ۳.۲): چیدمان مشترک پنجره‌ها و دکمه‌های ثبت روی گوشی.
 * پنجره‌ای که روی رایانه وسط صفحه باز می‌شود، روی گوشی (کمتر از ۶۴۰ پیکسل) تمام صفحه را می‌گیرد؛ دکمه‌ها دست‌کم ۴۴ پیکسل
 * بلندی دارند و دکمه‌ای که چیزی را ثبت می‌کند تا وصل شدن اینترنت غیرفعال است (ت۱۰ الف؛ درخواست نوشتنی پس از خطای شبکه
 * خودکار دوباره فرستاده نمی‌شود، TD-670).
 */

/** پس‌زمینه پنجره: روی گوشی بی فاصله، روی رایانه با فاصله و در وسط */
export const PHONE_SHEET_OVERLAY = 'fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm';

/** بدنه پنجره: روی گوشی تمام‌صفحه و بی گوشه گرد، روی رایانه کارت وسط صفحه */
export const PHONE_SHEET_PANEL = 'w-full h-full sm:h-auto max-h-full sm:max-h-[92vh] rounded-none sm:rounded-2xl flex flex-col';

/** پایین پنجره روی گوشی از زیر نوار خانه آیفون بیرون می‌ماند */
export const PHONE_SHEET_FOOTER_SAFE_AREA = 'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-0';

/** بلندی کمینه دکمه‌ای که با انگشت زده می‌شود */
export const PHONE_TAP_TARGET = 'min-h-11';

/** راهنمای دکمه ثبت غیرفعال وقتی اتصال قطع است */
export const OFFLINE_SUBMIT_TITLE = 'اتصال قطع است؛ پس از وصل شدن ثبت کنید.';
