import { checkMixedStockPathsNoDeadlock, checkVoidKardexOrderMatchesLive, checkVoidsOfSharedItemNoDeadlock } from './concurrencyScenarios.js';
import { checkReversalLifecycle, checkVoucherReversedOnce } from './voucherConcurrencyScenarios.js';
import { checkBankSyncFromTransactions, checkDeletedChequeFrozen, checkTransferVoidedTogether } from './treasuryConcurrencyScenarios.js';
import { checkRequisitionReceivedOnce } from './procurementConcurrencyScenarios.js';
import { checkProjectDeliveryCapped } from './projectConcurrencyScenarios.js';
import { checkDlqReplayedOnce } from './eventConcurrencyScenarios.js';

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
  ['inv_td_327_project_delivery_capped', 'v8.0.52: «ورود به انبار» پروژه بی‌دلیل از مقدار برنامه‌ریزی‌شده بیشتر نمی‌شود (هم‌زمان یا پشت هم)، با دلیل ثبت می‌شود، و پروژه لغوشده یا کالای بیرون از پروژه تحویل نمی‌شود (TD-327)',
    checkProjectDeliveryCapped, 'از دو تحویل هم‌زمان یکی پذیرفته شد؛ تحویل اضافه بی‌دلیل رد و با دلیل ثبت شد؛ پروژه لغوشده و کالای بیرونی رد شدند'],
  ['inv_td_341_transfer_voided_together', 'v8.0.53: ابطال هر طرف انتقال بین بانک‌ها هر دو ردیف، هر دو مانده و سند مشترک را با هم برمی‌گرداند؛ ابطال هم‌زمان دو طرف یکی پذیرفته می‌شود و انتقال نیمه‌باطل قدیمی ترمیم‌پذیر است (TD-341)',
    () => checkTransferVoidedTogether(), 'در هر چهار حالت هر دو مانده به ۵۰۰۰ و صفر برگشت، هر دو طرف باطل و سند مشترک بی‌اثر شد'],
  ['inv_td_340_bank_sync_from_transactions', 'v8.0.54: «همگام‌سازی مانده بانک‌ها» مانده را زیر قفل از مانده اول دوره، تراکنش‌های خزانه و چک‌های وصول‌شده می‌سازد؛ سند پیش‌نویس و پرداخت هم‌زمان مانده را خراب نمی‌کنند (TD-340)',
    () => checkBankSyncFromTransactions(), 'مانده‌ها ۷۰۰، ۳۰۰ و ۷۰۰۰ ماندند؛ گزارش مانده خزانه را نشان داد'],
  ['inv_td_342_dlq_replayed_once', 'v8.0.55: رویداد صف خطا (DLQ) یک بار بازپخش می‌شود؛ بازپخش، صرف‌نظر و بازگردانی گروهی هم‌زمان با بازپخش کنار می‌مانند و رویداد بازپخش‌شده دوباره بازپخش نمی‌شود (TD-342)',
    () => checkDlqReplayedOnce(), 'گرداننده یک بار اجرا شد؛ کار هم‌زمان و بازپخش دوباره رد شد؛ رویداد صرف‌نظرشده یک بار بازپخش شد'],
];
