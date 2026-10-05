import { checkMixedStockPathsNoDeadlock, checkVoidKardexOrderMatchesLive, checkVoidsOfSharedItemNoDeadlock } from './concurrencyScenarios.js';
import { checkVoucherReversedOnce } from './voucherConcurrencyScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه J در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const CONCURRENCY_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_320_void_shared_item_no_deadlock', 'v8.0.47: هشت ابطال هم‌زمانِ فاکتورهای یک کالا بی‌بن‌بست پشت هم اجرا می‌شوند و موجودی و میانگین موزون دقیق برمی‌گردند (TD-320)',
    checkVoidsOfSharedItemNoDeadlock, 'هر هشت ابطال انجام شد؛ موجودی ۲۰ و میانگین موزون ۱۰۰٬۰۰۰ برگشت؛ بدون نقض'],
  ['inv_td_320_stock_paths_no_deadlock', 'v8.0.47: فاکتور، رسید، ابطال، نهایی‌سازی و برگشت از فروش هم‌زمان روی دو کالا با ترتیب سطرهای مخالف به بن‌بست نمی‌رسند (TD-320)',
    checkMixedStockPathsNoDeadlock, 'نُه عملیات هم‌زمان بدون بن‌بست؛ ناوردایی‌ها برقرار'],
  ['inv_td_320_void_kardex_order', 'v8.0.47: ردیف کاردکس معکوسِ ابطالی که پشت قفل کالا منتظر مانده پس از فروش میانی شماره می‌گیرد و بازسازی کاردکس همان میانگین موزون زنده را می‌دهد (TD-320)',
    checkVoidKardexOrderMatchesLive, 'موجودی ۱۱؛ بازسازی کاردکس با میانگین موزون زنده یکی است (I13)'],
  ['inv_td_321_voucher_reversed_once', 'v8.0.48: هر سند حسابداری فقط یک بار برگشت می‌خورد؛ دو اصلاح و یک ابطال هم‌زمان فقط یکی را می‌پذیرند و ابطال و بازثبت پس از ابطال یا پیش از اصلاح رد می‌شود (TD-321)',
    () => checkVoucherReversedOnce(), 'از سه برگشت هم‌زمان یکی پذیرفته شد و برگشت دوم پشت هم رد شد؛ هر سند یک سند برگشت فعال دارد'],
];
