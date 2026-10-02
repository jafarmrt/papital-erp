import type { ComponentType, ReactNode } from 'react';

/**
 * v7.0.86 (TD-108): نشان (Badge) مشترک وضعیت / اولویت.
 * هر صفحه واژه‌ها و رنگ‌های خودش را به شکل یک نقشه ثابت (`PillBadgeVariants`) تعریف می‌کند و این کامپوننت فقط
 * آن را رسم می‌کند؛ پیش از این هر صفحه یک تابع switch جدا با همان ساختار JSX داشت.
 */
export interface PillBadgeVariant {
  /** متن نشان؛ اگر خالی باشد خود مقدار نمایش داده می‌شود */
  label?: ReactNode;
  className: string;
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
}

export type PillBadgeVariants = Readonly<Record<string, PillBadgeVariant>>;

/** نوع نشان مقدار، یا fallback وقتی مقدار در نقشه نیست. */
export function resolvePillVariant(
  variants: PillBadgeVariants,
  value: string | null | undefined,
  fallback?: PillBadgeVariant,
): PillBadgeVariant | undefined {
  if (value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(variants, value)) {
    return variants[value];
  }
  return fallback;
}

interface PillBadgeProps {
  variants: PillBadgeVariants;
  value: string | null | undefined;
  /** نشان مقدارهای خارج از نقشه؛ بدون آن چیزی رسم نمی‌شود */
  fallback?: PillBadgeVariant;
  /** متن جایگزین (مثلاً همراه درصد پیشرفت) */
  label?: ReactNode;
}

export function PillBadge({ variants, value, fallback, label }: PillBadgeProps) {
  const variant = resolvePillVariant(variants, value, fallback);
  if (!variant) return null;
  const Icon = variant.icon;
  return (
    <span className={variant.className}>
      {Icon ? <Icon className={variant.iconClassName} /> : null}
      {label ?? variant.label ?? value}
    </span>
  );
}
