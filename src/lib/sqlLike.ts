/**
 * v7.0.53 (audit P2-10): ورودی کاربر در الگوی LIKE / ILIKE.
 * `%` و `_` در PostgreSQL نویسه عام هستند و `\` نویسه escape پیش‌فرض LIKE است؛ بدون escape، جستجوی «%» همه ردیف‌ها
 * و «_» هر نویسه‌ای را تطبیق می‌دهد. خروجی همیشه به‌صورت پارامتر به کوئری داده می‌شود.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** الگوی «شامل بودن» برای ILIKE: `%<ورودی escape‌شده>%` */
export function containsLikePattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

/** الگوی «شروع شدن با» برای LIKE / ILIKE: `<ورودی escape‌شده>%` */
export function startsWithLikePattern(value: string): string {
  return `${escapeLikePattern(value)}%`;
}
