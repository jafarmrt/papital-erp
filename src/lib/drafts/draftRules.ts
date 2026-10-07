/**
 * v9.0.294 (TD-677، B16-13): شکل نشانی پیش‌نویس فرم. نوع (`invoice`، `voucher` و ...) و کلید (`new_invoice`، `edit_12`)
 * فقط حروف لاتین، رقم، «_» و «-» با سقف طول‌اند. پیش‌تر هر رشته‌ای پذیرفته می‌شد و نویسه `\u0000` خطای خام پایگاه‌داده را
 * با متن SQL و پارامترها به مرورگر برمی‌گرداند.
 */
export const DRAFT_ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
export const DRAFT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DRAFT_DEFAULT_KEY = 'default';
