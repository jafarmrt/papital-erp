/**
 * Shared Persian names of the material allocation screen and of an allocation's status, used by the allocation tab and by
 * the server messages that point to it.
 *
 * v10.0.38 (TD-1143): a project with an open allocation is neither deleted nor cancelled (TD-412 / TD-759); the refusal
 * sent the user to «زبانه مواد پروژه», which no project screen has. Allocations are released only in the
 * «تخصیص مواد به پروژه‌ها» tab of the «انبارگردانی دوره‌ای» page (`/audit`, TD-760).
 * v10.0.39 (TD-1144): consume and release refusals printed the status code (`allocated`, `consumed`, `released`).
 */
export const STOCK_COUNT_PAGE_LABEL = 'انبارگردانی دوره‌ای';
export const BOM_ALLOCATIONS_TAB_LABEL = 'تخصیص مواد به پروژه‌ها';
/** Where an allocation is released, as a user reads it in a message */
export const ALLOCATION_RELEASE_PLACE = `صفحه «${STOCK_COUNT_PAGE_LABEL}»، زبانه «${BOM_ALLOCATIONS_TAB_LABEL}»`;

export const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  allocated: 'در جریان تولید',
  consumed: 'مصرف‌شده',
  released: 'آزادشده',
};

export const allocationStatusLabel = (status: string | null | undefined): string =>
  ALLOCATION_STATUS_LABELS[String(status ?? '')] ?? 'نامشخص';
