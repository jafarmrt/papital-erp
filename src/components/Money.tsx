import React from 'react';
import { formatPersianPrice } from '../utils';

export interface MoneyProps {
  amount: number | string | null | undefined;
  currency?: string;
  className?: string;
}

/**
 * V9 Phase 3: کامپوننت مرکزی نمایش مبلغ با ارز داینامیک.
 * هیچ ارز ثابتی در UI نوشته نمی‌شود؛ برچسب ارز از فیلد currency رکورد
 * یا از تنظیمات سامانه (useAppCurrency) تأمین می‌شود.
 */
export function Money({ amount, currency, className }: MoneyProps) {
  return <span className={className} suppressHydrationWarning>{formatPersianPrice(amount, currency)}</span>;
}
