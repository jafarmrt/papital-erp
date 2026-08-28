/**
 * Frontend Error Translation & Localization Helper
 * Fulfills Subphase 12.2 specification for client-side localization of stable backend error codes.
 */

export interface TranslatedError {
  code: string;
  message: string;
  userFriendlyMessage: string;
  details?: any;
}

const ERROR_DICTIONARY_FA: Record<string, string> = {
  INSUFFICIENT_STOCK: 'موجودی انبار برای ثبت این اقدام کافی نمی‌باشد.',
  ACCOUNTING_UNBALANCED: 'سند حسابداری موازنه نیست؛ مجموع بدهکار با بستانکار برابر می‌باشد.',
  VALIDATION_ERROR: 'اطلاعات ورودی در فرم معتبر نیست. لطفاً فیلدهای مشخص‌شده را بررسی فرمایید.',
  AUTHENTICATION_ERROR: 'نشست کاربری شما منقضی شده است. لطفاً مجدداً وارد شوید.',
  AUTHORIZATION_ERROR: 'شما دسترسی لازم جهت اجرای این عملیات را ندارید.',
  NOT_FOUND_ERROR: 'مورد درخواستی در پایگاه داده یافت نشد.',
  CONFLICT_ERROR: 'رکورد مشابهی با همین مشخصات در سیستم وجود دارد.',
  DUPLICATE_RESOURCE: 'شناسه یا عنوان ارسالی تکراری است.',
  BUSINESS_RULE_ERROR: 'اجرای عملیات با قوانین کسب‌وکار و فرآیندهای مالی سیستم مغایرت دارد.',
  WORKFLOW_ERROR: 'خطا در چرخه کاری و تغییر وضعیت سند رخ داده است.',
  WORKFLOW_RULE_FAILED: 'شرایط پیش‌فرض برای انصراف یا تأیید این مرحله احراز نشده است.',
  CONCURRENCY_ERROR: 'به دلیل همزمانی تغییرات توسط کاربر دیگر، عملیات لغو شد. لطفاً صفحه را تازه‌سازی نمایید.',
  IDEMPOTENCY_CONFLICT: 'درخواست تکراری تشخیص داده شد. عملیات قبلاً در سرور پردازش شده است.',
  RATE_LIMIT_EXCEEDED: 'تعداد درخواست‌های ارسالی بیش از حد مجاز است. لطفاً چند لحظه شکیبا باشید.',
  INTEGRATION_ERROR: 'ارتباط با سرویس خارجی یا ووکامرس با خطا مواجه گردید.',
  NETWORK_ERROR: 'ارتباط با سرور برقرار نشد. لطفاً اتصال اینترنت خود را بررسی فرمایید.',
  INTERNAL_SERVER_ERROR: 'خطای غیرمنتظره در سرور رخ داد. موضوع به تیم پشتیبانی گزارش گردید.'
};

export function translateErrorCode(code: string, fallbackMessage = ''): string {
  if (ERROR_DICTIONARY_FA[code]) {
    return ERROR_DICTIONARY_FA[code];
  }
  return fallbackMessage || 'خطایی در سیستم رخ داده است.';
}

export function formatApiError(err: any): TranslatedError {
  const code = err?.code || 'UNKNOWN_ERROR';
  const rawMessage = err?.message || 'خطایی در پردازش درخواست رخ داد.';
  const userFriendlyMessage = ERROR_DICTIONARY_FA[code] || rawMessage;

  return {
    code,
    message: rawMessage,
    userFriendlyMessage,
    details: err?.details || null
  };
}
