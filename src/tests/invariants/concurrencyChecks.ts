import { checkMixedStockPathsNoDeadlock, checkVoidKardexOrderMatchesLive, checkVoidsOfSharedItemNoDeadlock } from './concurrencyScenarios.js';
import { checkReversalLifecycle, checkVoucherReversedOnce } from './voucherConcurrencyScenarios.js';
import { checkDeletedChequeFrozen } from './treasuryConcurrencyScenarios.js';
import { checkRequisitionReceivedOnce } from './procurementConcurrencyScenarios.js';

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
  ['inv_td_322_deleted_cheque_frozen', 'v8.0.49: چک حذف‌شده وصول یا دوباره حذف نمی‌شود و از حذف و وصول هم‌زمان فقط یکی پذیرفته می‌شود (TD-322)',
    () => checkDeletedChequeFrozen(), 'وصول و حذف دوباره چک حذف‌شده «یافت نشد»؛ در سه دور حذف و وصول هم‌زمان فقط یکی پذیرفته شد و مانده بانک درست ماند'],
  ['inv_td_323_reversal_lifecycle', 'v8.0.50: سند پیش‌نویس برگشت یا اصلاح نمی‌خورد و سندی که سند برگشت فعال دارد به پیش‌نویس برنمی‌گردد و حذف نمی‌شود (TD-323)',
    checkReversalLifecycle, 'ابطال و اصلاح پیش‌نویس رد شد؛ سند دستی و سند فاکتورِ ابطال‌شده به پیش‌نویس برنگشتند و حذف نشدند'],
  ['inv_td_326_requisition_received_once', 'v8.0.51: «دریافت کالا»ی درخواست خرید کالا را فقط یک بار وارد انبار می‌کند؛ هم‌زمان با تبدیل به سفارش، پیش از آن، دو بار هم‌زمان، و با سفارش جزئی یا سفارشی که نهایی نشد (TD-326)',
    checkRequisitionReceivedOnce, 'در هر پنج حالت موجودی برابر مقدار دریافتی درخواست است؛ دریافت و سفارش دوباره رد شد؛ یک نمونه گردش‌کار'],
];
