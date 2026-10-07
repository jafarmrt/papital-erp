/**
 * v9.0.286 (TD-805، B12P-02، تصمیم مالک محصول ت۲ الف): هر کار حقوق و دستمزد کلید هم‌نام خودش را می‌پرسد، در API و در
 * دکمه‌ها. پیش‌تر «مدیریت کامل پرسنل» به‌تنهایی نرخ، کارکرد، صدور، پرداخت و ابطال را داشت و کلیدهای کارمزدی کاری را که
 * عنوانشان می‌گفت نمی‌کردند. `personnel.manage` فقط پرونده پرسنل است.
 */
/** عنوان و دسته کاری، بارگذاری اکسل عناوین، نرخ پایه، نرخ اختصاصی پرسنل و نرخ دستی کارکرد */
export const PIECEWORK_TASKS_PERMISSION = 'piecework.manage_tasks';
/** ثبت، ویرایش و حذف کارکرد آزاد */
export const PIECEWORK_LOG_PERMISSION = 'piecework.log';
/** صدور، تغییر وضعیت، ثبت سند و ابطال فیش */
export const PIECEWORK_PAYROLL_PERMISSION = 'piecework.payroll';
/** ثبت پرداخت فیش و ابطال پرداخت */
export const PIECEWORK_PAY_PERMISSION = 'piecework.pay';
